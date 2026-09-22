import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadNewExercisesForCourse } from "../../actions/downloadNewExercisesForCourse"
import { downloadOrUpdateExercises } from "../../actions/downloadOrUpdateExercises"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ReadyActionContext } from "../../actions/types"
import type { UserData } from "../../config/userdata"
import { TmcPanel } from "../../panels/TmcPanel"
import type { ExtensionToWebview, LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions/downloadOrUpdateExercises", () => ({
  downloadOrUpdateExercises: vi.fn(),
}))
vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(),
}))

const COURSE_ID = CourseIdentifier.from(1)

function courseWithNewExercises(newExercises: number[]): LocalCourseData {
  return makeTmcKind({
    id: 1,
    name: "test-python-course",
    title: "The Python Course",
    description: "",
    organization: "test",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises,
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })
}

suite("downloadNewExercisesForCourse action", function () {
  let course: LocalCourseData
  let webviewMessages: ExtensionToWebview[]

  // Clears exactly what UserData clears, so the action reads its announcements
  // back out of real state instead of a canned answer.
  function actionContext(): ReadyActionContext {
    const userData = {
      getCourse: () => Ok(course),
      clearFromNewExercises: async (
        _courseId: CourseIdentifier,
        cleared?: ExerciseIdentifier[],
      ) => {
        const clearedIds = new Set((cleared ?? []).map((id) => ExerciseIdentifier.unwrap(id)))
        if (course.kind === "tmc") {
          course.data.newExercises = course.data.newExercises.filter((id) => !clearedIds.has(id))
        }
        return Ok.EMPTY
      },
    } as unknown as UserData
    return createMockActionContext({ startup: { userData } })
  }

  const announcedNewExercises = (): ExerciseIdentifier[] | undefined =>
    webviewMessages
      .filter((message) => message.type === "setNewExercises")
      .at(-1)
      ?.exerciseIds.slice()

  beforeEach(function () {
    course = courseWithNewExercises([1, 2])
    webviewMessages = []
    vi.spyOn(TmcPanel, "postMessage").mockImplementation(async (...messages) => {
      webviewMessages.push(...messages)
    })
    vi.mocked(refreshLocalExercises).mockResolvedValue(Ok.EMPTY)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("announces nothing new once every exercise has been downloaded", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({ successful: [ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)], failed: [] }),
    )

    const result = await downloadNewExercisesForCourse(actionContext(), COURSE_ID)

    expect(result.ok).toBe(true)
    expect(announcedNewExercises()).toEqual([])
  })

  test("keeps announcing only the exercises that failed to download", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({ successful: [ExerciseIdentifier.from(1)], failed: [ExerciseIdentifier.from(2)] }),
    )

    await downloadNewExercisesForCourse(actionContext(), COURSE_ID)

    expect(announcedNewExercises()).toEqual([ExerciseIdentifier.from(2)])
  })

  test("restores the announcement when the download throws", async function () {
    vi.mocked(downloadOrUpdateExercises).mockRejectedValue(new Error("boom"))

    await expect(downloadNewExercisesForCourse(actionContext(), COURSE_ID)).rejects.toThrow("boom")

    expect(announcedNewExercises()).toEqual([
      ExerciseIdentifier.from(1),
      ExerciseIdentifier.from(2),
    ])
  })

  test("restores the announcement when the download fails outright", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(Err(new Error("boom")))

    const result = await downloadNewExercisesForCourse(actionContext(), COURSE_ID)

    expect(result.err).toBe(true)
    expect(announcedNewExercises()).toEqual([
      ExerciseIdentifier.from(1),
      ExerciseIdentifier.from(2),
    ])
  })
})
