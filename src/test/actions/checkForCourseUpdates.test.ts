import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { checkForCourseUpdates } from "../../actions/checkForCourseUpdates"
import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { updateCourse } from "../../actions/updateCourse"
import type Dialog from "../../api/dialog"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/updateCourse", () => ({
  updateCourse: vi.fn(async () => Ok(true)),
}))

// The course-update pass ends by rescanning the exercises on disk, which would otherwise
// drive real CLI calls.
vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(async () => Ok.EMPTY),
}))

const tmcCourse = (id: number, notifyAfter: number, newExercises: number[]): LocalCourseData =>
  makeTmcKind({
    id,
    name: `course-${id}`,
    title: `Course ${id}`,
    description: "",
    organization: "test",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises,
    notifyAfter,
    disabled: false,
    materialUrl: null,
  })

function contextWithCourses(courses: LocalCourseData[]): [ReadyActionContext, Dialog] {
  const [dialog] = createDialogMock()
  const byId = new Map(courses.map((c) => [String(c.data.id), c]))
  return [
    {
      ...createMockActionContext({
        startup: {
          userData: {
            getCourses: () => courses,
            getCourse: (id: CourseIdentifier) => Ok(byId.get(CourseIdentifier.toString(id))),
          } as unknown as ReadyStartup["userData"],
        },
      }),
      dialog,
    },
    dialog,
  ]
}

suite("checkForCourseUpdates action", function () {
  beforeEach(function () {
    vi.mocked(updateCourse).mockReset()
    vi.mocked(updateCourse).mockResolvedValue(Ok(true))
  })

  test("refreshes a course whose new-exercise reminder is postponed", async function () {
    const [actionContext] = contextWithCourses([tmcCourse(1, Date.now() + 60_000, [10])])

    await checkForCourseUpdates(actionContext)

    expect(updateCourse).toHaveBeenCalledTimes(1)
    expect(updateCourse).toHaveBeenCalledWith(actionContext, CourseIdentifier.from(1))
  })

  test("rescans the exercises on disk once, however many courses were refreshed", async function () {
    // `updateCourse` does not rescan, so without this pass an exercise the backend
    // dropped keeps showing as open until something else happens to rescan.
    vi.mocked(refreshLocalExercises).mockClear()
    const [actionContext] = contextWithCourses([
      tmcCourse(1, Date.now() + 60_000, [10]),
      tmcCourse(2, Date.now() + 60_000, [20]),
    ])

    await checkForCourseUpdates(actionContext)

    expect(refreshLocalExercises).toHaveBeenCalledExactlyOnceWith(actionContext)
  })

  test("refreshes the other courses after one fails, and names the failure", async function () {
    vi.mocked(updateCourse).mockImplementation(async (_actionContext, id) =>
      CourseIdentifier.toString(id) === "1" ? Err(new Error("boom")) : Ok(true),
    )
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, []), tmcCourse(2, 0, [])])

    const result = await checkForCourseUpdates(actionContext)

    expect(updateCourse).toHaveBeenCalledTimes(2)
    expect(result.ok && result.val.failure?.message).toContain("course-1")
    expect(result.ok && result.val.courses.map((x) => x.data.id)).toEqual([1, 2])
    expect(dialog.reportError).not.toHaveBeenCalled()
  })

  test("returns the courses as stored after the pass, and no failure", async function () {
    const [actionContext, dialog] = contextWithCourses([tmcCourse(1, 0, [10])])

    const result = await checkForCourseUpdates(actionContext)

    expect(result.ok && result.val).toEqual({
      courses: [tmcCourse(1, 0, [10])],
      failure: undefined,
    })
    expect(dialog.notification).not.toHaveBeenCalled()
  })

  test("fails for a requested course that is not stored", async function () {
    const [actionContext] = contextWithCourses([])
    actionContext.startup.userData.getCourse = (): Err<Error> => Err(new Error("no such course"))

    const result = await checkForCourseUpdates(actionContext, {
      courseId: CourseIdentifier.from(9),
    })

    expect(result.err && result.val.message).toBe("no such course")
    expect(updateCourse).not.toHaveBeenCalled()
  })

  test("reports progress as each course finishes", async function () {
    const reported: [number, number][] = []
    const [actionContext] = contextWithCourses([tmcCourse(1, 0, []), tmcCourse(2, 0, [])])

    await checkForCourseUpdates(actionContext, {
      onProgress: (done, total) => {
        reported.push([done, total])
      },
    })

    expect(reported).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })
})
