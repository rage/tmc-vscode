import { Ok } from "ts-results"

import type { LocalCourseData } from "../../../shared/lib"
import { LocalCourseData as LocalCourseDataNs } from "../../../shared/lib"
import { recordMoocEnrollment } from "../../actions/courseAccess"
import type { ReadyStartup } from "../../actions/types"
import { ExerciseNotFoundError, InsufficientScopeError, NotEnrolledError } from "../../errors"
import { moocLocalCourse, tmcLocalCourse } from "../fixtures/courses"
import { createMockActionContext } from "../mocks/actionContext"

function setup(course: LocalCourseData) {
  const replaceCourse = vi.fn(async () => Ok.EMPTY)
  const actionContext = createMockActionContext({
    startup: {
      userData: {
        getCourse: () => Ok(course),
        replaceCourse,
      } as unknown as ReadyStartup["userData"],
    },
  })
  return { actionContext, replaceCourse, courseId: LocalCourseDataNs.getCourseId(course) }
}

suite("recordMoocEnrollment", function () {
  test("marks a course whose call was refused as not enrolled", async function () {
    const course = moocLocalCourse()
    const { actionContext, replaceCourse, courseId } = setup(course)

    await recordMoocEnrollment(actionContext, courseId, new NotEnrolledError("no"))

    expect(replaceCourse).toHaveBeenCalledExactlyOnceWith({
      kind: "mooc",
      data: { ...course.data, notEnrolled: true },
    })
  })

  test("clears the mark once a call succeeds", async function () {
    const course = moocLocalCourse({ notEnrolled: true })
    const { actionContext, replaceCourse, courseId } = setup(course)

    await recordMoocEnrollment(actionContext, courseId, undefined)

    expect(replaceCourse).toHaveBeenCalledExactlyOnceWith(moocLocalCourse())
  })

  // An exam exercise answers 404 to an enrolled student; tmc-langs reports any mooc 403 as a
  // scope problem.
  test.each([new ExerciseNotFoundError("exam"), new InsufficientScopeError("403")])(
    "leaves the course alone for %s",
    async function (error) {
      const { actionContext, replaceCourse, courseId } = setup(moocLocalCourse())

      await recordMoocEnrollment(actionContext, courseId, error)

      expect(replaceCourse).not.toHaveBeenCalled()
    },
  )

  test("leaves a tmc course alone", async function () {
    const { actionContext, replaceCourse, courseId } = setup(tmcLocalCourse())

    await recordMoocEnrollment(actionContext, courseId, new NotEnrolledError("no"))

    expect(replaceCourse).not.toHaveBeenCalled()
  })
})
