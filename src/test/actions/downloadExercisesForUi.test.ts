import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadExercisesForUi } from "../../actions/downloadExercisesForUi"
import { downloadOrUpdateExercises } from "../../actions/downloadOrUpdateExercises"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { postUpdateables } from "../../panels/exerciseLists"
import { TmcPanel } from "../../panels/TmcPanel"
import { updateablesRegistry } from "../../panels/updateablesRegistry"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../panels/TmcPanel", () => ({
  TmcPanel: { postMessage: vi.fn() },
}))

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
            clearFromNewExercises: async () => Ok.EMPTY,
          } as unknown as ReadyStartup["userData"],
        },
      }),
      dialog,
    },
    dialog,
  ]
}

/** The exercise ids of every `setUpdateables` posted, in order. */
function updateablesPosted(): number[][] {
  return vi
    .mocked(TmcPanel.postMessage)
    .mock.calls.flat()
    .filter((message) => message.type === "setUpdateables")
    .map((message) => message.exerciseIds.map((x) => ExerciseIdentifier.unwrap(x) as number))
}

/** The exercise ids of every `setNewExercises` posted, in order. */
function newExercisesPosted(): number[][] {
  return vi
    .mocked(TmcPanel.postMessage)
    .mock.calls.flat()
    .filter((message) => message.type === "setNewExercises")
    .map((message) => message.exerciseIds.map((x) => ExerciseIdentifier.unwrap(x) as number))
}

beforeEach(() => {
  updateablesRegistry.clear()
  vi.mocked(TmcPanel.postMessage).mockReset()
  vi.mocked(downloadOrUpdateExercises).mockReset()
  vi.mocked(refreshLocalExercises).mockReset().mockResolvedValue(Ok.EMPTY)
})

suite("downloadExercisesForUi, updating exercises", function () {
  const requested = [ExerciseIdentifier.from(101), ExerciseIdentifier.from(102)]

  beforeEach(function () {
    postUpdateables(COURSE_ID, requested)
    vi.mocked(TmcPanel.postMessage).mockClear()
  })

  test("puts the update list back when the download fails", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(Err(new Error("download failed")))
    const [actionContext, dialog] = contextWith([])

    await downloadExercisesForUi(actionContext, "update", COURSE_ID, requested)

    // The list is emptied while the download runs; leaving it that way tells the
    // student there is nothing left to update.
    expect(updateablesPosted()).toEqual([[], [101, 102]])
    expect(updateablesRegistry.get(COURSE_ID)).toEqual(requested)
    expect(dialog.reportError).toHaveBeenCalledWith(
      "Failed to update exercises.",
      expect.any(Error),
      "tmc",
    )
  })

  test("puts the update list back when the download throws", async function () {
    vi.mocked(downloadOrUpdateExercises).mockRejectedValue(new Error("spawn failed"))
    const [actionContext] = contextWith([])

    await expect(
      downloadExercisesForUi(actionContext, "update", COURSE_ID, requested),
    ).rejects.toThrow("spawn failed")

    expect(updateablesPosted()).toEqual([[], [101, 102]])
    expect(updateablesRegistry.get(COURSE_ID)).toEqual(requested)
  })

  test("reports only the exercises that failed when the download succeeds", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({ successful: [ExerciseIdentifier.from(101)], failed: [ExerciseIdentifier.from(102)] }),
    )
    const [actionContext] = contextWith([])

    await downloadExercisesForUi(actionContext, "update", COURSE_ID, requested)

    expect(updateablesPosted()).toEqual([[], [102]])
  })

  test("refreshes the local exercises it just replaced", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(Ok({ successful: [], failed: [] }))
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

  test("puts the new-exercise list back when the download fails", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(Err(new Error("download failed")))
    const [actionContext, dialog] = contextWith([201, 202])

    await downloadExercisesForUi(actionContext, "download", COURSE_ID, requested)

    expect(newExercisesPosted()).toEqual([[], [201, 202]])
    expect(dialog.reportError).toHaveBeenCalledWith(
      "Failed to download new exercises.",
      expect.any(Error),
      "tmc",
    )
  })

  test("puts the new-exercise list back when the download throws", async function () {
    vi.mocked(downloadOrUpdateExercises).mockRejectedValue(new Error("spawn failed"))
    const [actionContext] = contextWith([201, 202])

    await expect(
      downloadExercisesForUi(actionContext, "download", COURSE_ID, requested),
    ).rejects.toThrow("spawn failed")

    expect(newExercisesPosted()).toEqual([[], [201, 202]])
  })

  test("announces only the exercises storage still calls new after a success", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({ successful: requested, failed: [] }),
    )
    // Storage has been cleared of the downloaded exercises by the time the list is
    // re-read, so restoring the pre-download snapshot would re-announce them.
    const [actionContext] = contextWith([])

    await downloadExercisesForUi(actionContext, "download", COURSE_ID, requested)

    expect(newExercisesPosted()).toEqual([[], []])
  })
})
