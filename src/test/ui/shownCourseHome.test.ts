import { shownCourseHome } from "../../ui/shownCourseHome"
import { idOfMoocCourse } from "../fixtures/identifiers"

suite("shown course home", function () {
  afterEach(function () {
    shownCourseHome.set(undefined)
  })

  test("fires when the course home on screen changes, not when it is recorded again", function () {
    let changes = 0
    const subscription = shownCourseHome.onDidChange(() => changes++)

    shownCourseHome.set(idOfMoocCourse("a"))
    shownCourseHome.set(idOfMoocCourse("a"))
    shownCourseHome.set(idOfMoocCourse("b"))
    shownCourseHome.set(undefined)
    subscription.dispose()

    expect(changes).toBe(3)
  })
})
