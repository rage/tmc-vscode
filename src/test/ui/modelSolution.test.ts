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

  test("has none for a mooc exercise, whose solution is on its course material page", function () {
    expect(
      modelSolutionUrl({
        exercise: makeMoocKind(
          moocCourseExercise({
            passed: true,
            pageUrl: "https://courses.example/page",
          }),
        ),
        course: moocLocalCourse(),
      }),
    ).toBeUndefined()
  })
})
