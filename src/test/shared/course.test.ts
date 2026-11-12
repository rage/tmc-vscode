import { isSoftDeadlineBinding, moocCourseUrlOf } from "../../../shared/lib"

suite("isSoftDeadlineBinding", () => {
  const early = "2026-10-01T00:00:00Z"
  const late = "2026-10-08T00:00:00Z"

  test("binds when it comes before the hard deadline", () => {
    expect(isSoftDeadlineBinding({ softDeadline: early, deadline: late })).toBe(true)
  })

  test("does not bind at or after the hard deadline", () => {
    expect(isSoftDeadlineBinding({ softDeadline: late, deadline: early })).toBe(false)
    expect(isSoftDeadlineBinding({ softDeadline: late, deadline: late })).toBe(false)
  })

  test("does not bind without both deadlines", () => {
    expect(isSoftDeadlineBinding({ softDeadline: early, deadline: null })).toBe(false)
    expect(isSoftDeadlineBinding({ softDeadline: null, deadline: late })).toBe(false)
  })
})

suite("moocCourseUrlOf", () => {
  test("cuts a material page's URL down to its course's", () => {
    expect(
      moocCourseUrlOf("https://courses.mooc.fi/org/uh-cs/courses/python/chapter-1/loops?x=1"),
    ).toBe("https://courses.mooc.fi/org/uh-cs/courses/python")
  })

  test("names no course for a URL laid out otherwise, or no URL at all", () => {
    expect(moocCourseUrlOf("https://courses.mooc.fi/somewhere/else")).toBeUndefined()
    expect(moocCourseUrlOf("not a url")).toBeUndefined()
  })
})
