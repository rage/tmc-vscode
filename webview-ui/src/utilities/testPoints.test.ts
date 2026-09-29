import { testResult } from "../test/fixtures"
import { awardedPoints } from "./testPoints"

suite("awardedPoints", () => {
  test("python: failed tests' points are already stripped, the passed ones are awarded", () => {
    const results = [
      testResult({ name: "a", successful: true, points: ["1.1"] }),
      testResult({ name: "b", successful: false, points: [] }),
      testResult({ name: "c", successful: false, points: [] }),
    ]

    expect([...awardedPoints(results)]).toEqual(["1.1"])
  })

  test("java: a point shared by several tests is counted once", () => {
    const results = [
      testResult({ name: "a", successful: true, points: ["1.1"] }),
      testResult({ name: "b", successful: true, points: ["1.1", "1.2"] }),
    ]

    expect([...awardedPoints(results)]).toEqual(["1.1", "1.2"])
  })

  test("java: a shared point is not awarded while any test carrying it fails", () => {
    const results = [
      testResult({ name: "a", successful: true, points: ["1.1"] }),
      testResult({ name: "b", successful: true, points: ["1.1"] }),
      testResult({ name: "c", successful: false, points: ["1.1"] }),
    ]

    expect(awardedPoints(results).size).toBe(0)
  })
})
