import { Visibility } from "../../ui/treeview/visibility"
import type { VisibilityGroup } from "../../ui/types"

function before(): {
  visibility: Visibility
  g0: VisibilityGroup
  g1: VisibilityGroup
  g2: VisibilityGroup
} {
  const visibility = new Visibility()

  const g0 = visibility.createGroup(false)
  const g1 = visibility.createGroup(false)
  const g2 = visibility.createGroup(false)

  return { visibility, g0, g1, g2 }
}

suite("Treeview Visibility tests", () => {
  test("Registered action ids must be unique", () => {
    const { visibility, g0, g1 } = before()
    visibility.registerAction("a0", [g0])
    expect(() => visibility.registerAction("a0", [g0])).toThrow()
    expect(() => visibility.registerAction("a0", [g1])).toThrow()
  })

  test("Action with no dependencies always visible", () => {
    const { visibility } = before()
    visibility.registerAction("a0", [])
    expect(visibility.getVisible("a0")).toBe(true)
  })

  test("Single group dependency works correctly", () => {
    const { visibility, g0 } = before()
    visibility.registerAction("a0", [g0])
    expect(visibility.getVisible("a0")).toBe(false)
    expect(visibility.setGroupVisible(g0)).toEqual([["a0", true]])
    expect(visibility.getVisible("a0")).toBe(true)
  })

  test("Negated group dependency works correctly", () => {
    const { visibility, g0 } = before()
    visibility.registerAction("a0", [g0.not])
    expect(visibility.getVisible("a0")).toBe(true)
    expect(visibility.setGroupVisible(g0)).toEqual([["a0", false]])
    expect(visibility.getVisible("a0")).toBe(false)
  })

  test("Multiple actions with multiple dependencies work correctly", () => {
    const { visibility, g0, g1, g2 } = before()

    visibility.registerAction("a0", [g0.not, g1, g2])
    visibility.registerAction("a1", [g0.not, g1.not, g2])
    visibility.registerAction("a2", [g0, g1, g2])
    visibility.registerAction("a3", [g0.not, g1.not, g2.not])

    expect(visibility.getVisible("a0")).toBe(false)
    expect(visibility.getVisible("a1")).toBe(false)
    expect(visibility.getVisible("a2")).toBe(false)
    expect(visibility.getVisible("a3")).toBe(true)

    expect(visibility.setGroupVisible(g2)).toEqual([
      ["a1", true],
      ["a3", false],
    ])
    expect(visibility.getVisible("a0")).toBe(false)
    expect(visibility.getVisible("a1")).toBe(true)
    expect(visibility.getVisible("a2")).toBe(false)
    expect(visibility.getVisible("a3")).toBe(false)

    expect(visibility.setGroupVisible(g1)).toEqual([
      ["a0", true],
      ["a1", false],
    ])
    expect(visibility.getVisible("a0")).toBe(true)
    expect(visibility.getVisible("a1")).toBe(false)
    expect(visibility.getVisible("a2")).toBe(false)
    expect(visibility.getVisible("a3")).toBe(false)

    expect(visibility.setGroupVisible(g0)).toEqual([
      ["a2", true],
      ["a0", false],
    ])
    expect(visibility.getVisible("a0")).toBe(false)
    expect(visibility.getVisible("a1")).toBe(false)
    expect(visibility.getVisible("a2")).toBe(true)
    expect(visibility.getVisible("a3")).toBe(false)
  })
})
