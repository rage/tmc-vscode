import { pointsText } from "../../ui/points"
import { countOf } from "../../utilities"

suite("pointsText", function () {
  test("is shown compactly and spoken in full", function () {
    expect(pointsText(3, 5)).toEqual({ short: "3/5", spoken: "3 of 5 points" })
  })

  test("is absent when there is nothing to earn", function () {
    expect(pointsText(0, 0)).toBeUndefined()
  })
})

suite("countOf", function () {
  test("adds an s to any count but one", function () {
    expect([0, 1, 2].map((count) => countOf(count, "new exercise"))).toEqual([
      "0 new exercises",
      "1 new exercise",
      "2 new exercises",
    ])
  })
})
