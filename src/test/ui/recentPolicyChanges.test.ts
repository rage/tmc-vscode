import { LocalCourseData } from "../../../shared/lib"
import { recentPolicyChanges } from "../../ui/recentPolicyChanges"
import { moocLocalCourse } from "../fixtures/courses"

suite("recentPolicyChanges", function () {
  const noAi = moocLocalCourse({ title: "Mooc Course", aiPolicy: "no_ai" })
  const notSet = moocLocalCourse({ title: "Mooc Course", aiPolicy: "not_set" })

  afterEach(function () {
    recentPolicyChanges.dismiss(LocalCourseData.getCourseId(noAi))
  })

  test("says what a course's new policy does to AI assistance", function () {
    recentPolicyChanges.addChangeOf(noAi)

    expect(recentPolicyChanges.get(noAi)).toBe(
      "AI may not be used at any point. AI assistance is off in this course.",
    )
  })

  test("says nothing of a change to no policy, and forgets the one before it", function () {
    recentPolicyChanges.addChangeOf(noAi)

    expect(recentPolicyChanges.addChangeOf(notSet)).toBeUndefined()
    expect(recentPolicyChanges.get(notSet)).toBeUndefined()
    expect(recentPolicyChanges.get(noAi)).toBeUndefined()
  })

  test("says nothing of a change the course's policy no longer holds", function () {
    recentPolicyChanges.addChangeOf(noAi)

    expect(recentPolicyChanges.get(notSet)).toBeUndefined()
  })
})
