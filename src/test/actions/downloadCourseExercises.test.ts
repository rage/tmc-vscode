import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { LocalCourseData } from "../../../shared/lib"
import { downloadCourseExercises } from "../../actions/downloadCourseExercises"
import { downloadOrUpdateExercises } from "../../actions/downloadOrUpdateExercises"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/downloadOrUpdateExercises", () => ({
  downloadOrUpdateExercises: vi.fn(),
}))

vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(),
}))

const COURSE_ID = idOfTmcCourse(1)

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
  const requested = [idOfTmcExercise(201), idOfTmcExercise(202)]

  test("takes what it downloaded off the course's new exercises, then rescans", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({
        successful: [idOfTmcExercise(201)],
        failed: [idOfTmcExercise(202)],
        warnings: [],
      }),
    )
    const [actionContext] = contextWith([201, 202])

    await downloadCourseExercises(actionContext, COURSE_ID, requested)

    expect(clearFromNewExercises).toHaveBeenCalledWith(COURSE_ID, [idOfTmcExercise(201)])
    expect(refreshLocalExercises).toHaveBeenCalledOnce()
  })

  test("reports a rescan that fails", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({ successful: requested, failed: [], warnings: [] }),
    )
    vi.mocked(refreshLocalExercises).mockResolvedValue(Err(new Error("refresh failed")))
    const [actionContext] = contextWith([201, 202])

    const result = await downloadCourseExercises(actionContext, COURSE_ID, requested)

    expect(result.unwrap().warnings).toEqual([
      { headline: "Failed to refresh local exercises.", error: expect.any(Error) },
    ])
  })
})
