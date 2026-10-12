import { withDistinctKeys } from "../../../shared/lib"

suite("withDistinctKeys", function () {
  test("keys a name already ending in a suffix apart from a repeat that would take it", function () {
    const keys = withDistinctKeys(["a", "a", "a#2", "a"], (name) => name).map(({ key }) => key)

    expect(keys).toEqual(["a", "a#2", "a#2#2", "a#3"])
  })
})
