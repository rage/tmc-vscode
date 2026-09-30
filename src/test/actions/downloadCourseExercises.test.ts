import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadCourseExercises } from "../../actions/downloadCourseExercises"
import { downloadOrUpdateExercises } from "../../actions/downloadOrUpdateExercises"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
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

beforeEach(() => {
  vi.restoreAllMocks()
  clearFromNewExercises.mockClear()
  vi.mocked(downloadOrUpdateExercises).mockReset()
  vi.mocked(refreshLocalExercises).mockReset().mockResolvedValue(Ok.EMPTY)
})

suite("downloadCourseExercises", function () {
  const requested = [ExerciseIdentifier.from(201), ExerciseIdentifier.from(202)]

  test("takes what it downloaded off the course's new exercises, then rescans", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({
        successful: [ExerciseIdentifier.from(201)],
        failed: [ExerciseIdentifier.from(202)],
      }),
    )
    const [actionContext] = contextWith([201, 202])

    await downloadCourseExercises(actionContext, COURSE_ID, requested)

    expect(clearFromNewExercises).toHaveBeenCalledWith(COURSE_ID, [ExerciseIdentifier.from(201)])
    expect(refreshLocalExercises).toHaveBeenCalledOnce()
  })

  test("reports a rescan that fails", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({ successful: requested, failed: [] }),
    )
    vi.mocked(refreshLocalExercises).mockResolvedValue(Err(new Error("refresh failed")))
    const [actionContext, dialog] = contextWith([201, 202])

    await downloadCourseExercises(actionContext, COURSE_ID, requested)

    expect(dialog.reportError).toHaveBeenCalledWith(
      "Failed to refresh local exercises.",
      expect.any(Error),
      "tmc",
    )
  })
})
