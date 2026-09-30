import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { downloadNewExercisesForCourse } from "../../actions/downloadNewExercisesForCourse"
import { downloadOrUpdateExercises } from "../../actions/downloadOrUpdateExercises"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ReadyActionContext } from "../../actions/types"
import type { UserData } from "../../config/userdata"
import { BottleneckError } from "../../errors"
import type { LocalCourseData } from "../../shared/shared"
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

  // Clears exactly what UserData clears, so the course's new exercises are real state.
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

  const stillNew = (): number[] => (course.kind === "tmc" ? course.data.newExercises : [])

  beforeEach(function () {
    course = courseWithNewExercises([1, 2])
    vi.mocked(refreshLocalExercises).mockResolvedValue(Ok.EMPTY)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("leaves nothing new once every exercise has been downloaded", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({
        successful: [ExerciseIdentifier.from(1), ExerciseIdentifier.from(2)],
        failed: [],
      }),
    )

    const result = await downloadNewExercisesForCourse(actionContext(), COURSE_ID)

    expect(result.ok).toBe(true)
    expect(stillNew()).toEqual([])
  })

  test("keeps only the exercises that failed to download new", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Ok({
        successful: [ExerciseIdentifier.from(1)],
        failed: [ExerciseIdentifier.from(2)],
      }),
    )

    await downloadNewExercisesForCourse(actionContext(), COURSE_ID)

    expect(stillNew()).toEqual([2])
  })

  test("keeps every exercise new when the download throws", async function () {
    vi.mocked(downloadOrUpdateExercises).mockRejectedValue(new Error("boom"))

    await expect(downloadNewExercisesForCourse(actionContext(), COURSE_ID)).rejects.toThrow("boom")

    expect(stillNew()).toEqual([1, 2])
  })

  test("keeps every exercise new when the download is refused as already running", async function () {
    vi.mocked(downloadOrUpdateExercises).mockResolvedValue(
      Err(new BottleneckError("Some of these exercises are already downloading.")),
    )

    const result = await downloadNewExercisesForCourse(actionContext(), COURSE_ID)

    expect(result.err && result.val).toBeInstanceOf(BottleneckError)
    expect(stillNew()).toEqual([1, 2])
  })
})
