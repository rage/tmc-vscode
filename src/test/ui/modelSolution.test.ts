import { makeMoocKind, makeTmcKind } from "../../../shared/lib"
import { modelSolutionUrl } from "../../ui/modelSolution"
import {
  moocCourseExercise,
  moocLocalCourse,
  tmcCourseExercise,
  tmcLocalCourse,
} from "../fixtures/courses"

suite("modelSolutionUrl", function () {
  test("links a passed tmc exercise's solution page on its server", function () {
    const url = modelSolutionUrl({
      exercise: makeTmcKind(tmcCourseExercise({ id: 41, passed: true })),
      course: tmcLocalCourse(),
    })

    expect(url).toMatch(/^https?:\/\/[^/]+\/exercises\/41\/solution$/)
  })

  test("has none for a tmc exercise not passed yet, or in a course that hides results", function () {
    expect(
      modelSolutionUrl({
        exercise: makeTmcKind(tmcCourseExercise({ passed: false })),
        course: tmcLocalCourse(),
      }),
    ).toBeUndefined()
    expect(
      modelSolutionUrl({
        exercise: makeTmcKind(tmcCourseExercise({ passed: true })),
        course: tmcLocalCourse({ perhapsExamMode: true }),
      }),
    ).toBeUndefined()
  })

  test("links a mooc exercise's material page once passed or out of tries", function () {
    const course = moocLocalCourse()
    const page = "https://courses.example/page"

    expect(
      modelSolutionUrl({
        exercise: makeMoocKind(moocCourseExercise({ passed: true, pageUrl: page })),
        course,
      }),
    ).toBe(page)
    expect(
      modelSolutionUrl({
        exercise: makeMoocKind(moocCourseExercise({ outOfTries: true, pageUrl: page })),
        course,
      }),
    ).toBe(page)
    expect(
      modelSolutionUrl({ exercise: makeMoocKind(moocCourseExercise({ pageUrl: page })), course }),
    ).toBeUndefined()
  })
})
