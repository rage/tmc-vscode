import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadExercisesForUi } from "../../actions/downloadExercisesForUi"
import { downloadOrUpdateExercises } from "../../actions/downloadOrUpdateExercises"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/downloadOrUpdateExercises", () => ({
  downloadOrUpdateExercises: vi.fn(),
}))

vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(),
}))

const COURSE_ID = CourseIdentifier.from(1)

/** The course as storage holds it, carrying the exercises not yet downloaded. */
function storedCourse(newExercises: number[]): LocalCourseData {
  return { kind: "tmc", data: { newExercises } } as unknown as LocalCourseData
}

const clearFromNewExercises = vi.fn(async () => Ok.EMPTY)

function contextWith(
  newExercises: number[],
): [ReadyActionContext, ReturnType<typeof createDialogMock>[0]] {
  const [dialog] = createDialogMock()
  return [
    {
      ...createMockActionContext({
        startup: {
          userData: {
            getCourse: () => Ok(storedCourse(newExercises)),
            clearFromNewExercises,
          } as unknown as ReadyStartup["userData"],
        },
      }),
      dialog,
    },
    dialog,
  ]
}

/** The exercise ids of every update list recorded, in order. */
function updateablesRecorded(): number[][] {
  return vi
    .mocked(updateablesRegistry.set)
    .mock.calls.map(([, exerciseIds]) =>
      exerciseIds.map((x) => ExerciseIdentifier.unwrap(x) as number),
    )
}

beforeEach(() => {
  updateablesRegistry.clear()
  vi.restoreAllMocks()
  vi.spyOn(updateablesRegistry, "set")
  clearFromNewExercises.mockClear()
  vi.mocked(downloadOrUpdateExercises).mockReset()
  vi.mocked(refreshLocalExercises).mockReset().mockResolvedValue(Ok.EMPTY)
})

suite("downloadExercisesForUi, updating exercises", function () {
  const requested = [ExerciseIdentifier.from(101), ExerciseIdentifier.from(102)]

  beforeEach(function () {
    updateablesRegistry.set(COURSE_ID, requested)
    vi.mocked(updateablesRegistry.set).mockClear()
  })

  test("puts the update list back when the download throws", async function () {
    vi.mocked(downloadOrUpdateExercises).mockRejectedValue(new Error("spawn failed"))
    const [actionContext] = contextWith([])

    await expect(
      downloadExercisesForUi(actionContext, "update", COURSE_ID, requested),
    ).rejects.toThrow("spawn failed")

    expect(updateablesRecorded()).toEqual([[], [101, 102]])
    expect(updateablesRegistry.get(COURSE_ID)).toEqual(requested)
  })

  test("reports only the exercises that failed when the download succeeds", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue({
      successful: [ExerciseIdentifier.from(101)],
      failed: [ExerciseIdentifier.from(102)],
    })
    const [actionContext] = contextWith([])

    await downloadExercisesForUi(actionContext, "update", COURSE_ID, requested)

    expect(updateablesRecorded()).toEqual([[], [102]])
  })

  test("refreshes the local exercises it just replaced", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue({ successful: [], failed: [] })
    vi.mocked(refreshLocalExercises).mockResolvedValue(Err(new Error("refresh failed")))
    const [actionContext, dialog] = contextWith([])

    await downloadExercisesForUi(actionContext, "update", COURSE_ID, requested)

    expect(refreshLocalExercises).toHaveBeenCalledTimes(1)
    expect(dialog.reportError).toHaveBeenCalledWith(
      "Failed to refresh local exercises.",
      expect.any(Error),
      "tmc",
    )
  })
})

suite("downloadExercisesForUi, downloading new exercises", function () {
  const requested = [ExerciseIdentifier.from(201), ExerciseIdentifier.from(202)]

  test("takes what it downloaded off the course's new exercises, then rescans", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue({
      successful: [ExerciseIdentifier.from(201)],
      failed: [ExerciseIdentifier.from(202)],
    })
    const [actionContext] = contextWith([201, 202])

    await downloadExercisesForUi(actionContext, "download", COURSE_ID, requested)

    expect(clearFromNewExercises).toHaveBeenCalledWith(COURSE_ID, [ExerciseIdentifier.from(201)])
    expect(refreshLocalExercises).toHaveBeenCalledOnce()
  })

  test("reports a rescan that fails", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue({ successful: requested, failed: [] })
    vi.mocked(refreshLocalExercises).mockResolvedValue(Err(new Error("refresh failed")))
    const [actionContext, dialog] = contextWith([201, 202])

    await downloadExercisesForUi(actionContext, "download", COURSE_ID, requested)

    expect(dialog.reportError).toHaveBeenCalledWith(
      "Failed to refresh local exercises.",
      expect.any(Error),
      "tmc",
    )
  })
})
