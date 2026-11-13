import { CourseWorkspaceSwitches } from "../../api/courseWorkspaceSwitches"
import { createMockMemento } from "../mocks/vscode"

suite("CourseWorkspaceSwitches", function () {
  let now: number
  let switches: CourseWorkspaceSwitches

  beforeEach(function () {
    now = 0
    switches = new CourseWorkspaceSwitches(createMockMemento(), () => now)
  })

  test("the window a switch opens finds it, once", async function () {
    await switches.record("/w/a.code-workspace", { isWalkthroughOpen: false })

    expect(await switches.take("/w/a.code-workspace")).toEqual({ isWalkthroughOpen: false })
    expect(await switches.take("/w/a.code-workspace")).toBeUndefined()
  })

  // Another window may start before the one the switch opens.
  test("another window neither finds the switch nor takes it away", async function () {
    await switches.record("/w/a.code-workspace", { isWalkthroughOpen: false })

    expect(await switches.take("/w/b.code-workspace")).toBeUndefined()
    expect(await switches.take(undefined)).toBeUndefined()
    expect(await switches.take("/w/a.code-workspace")).toBeDefined()
  })

  test("a switch minutes old no longer counts", async function () {
    await switches.record("/w/a.code-workspace", { isWalkthroughOpen: false })
    now = 3 * 60 * 1000

    expect(await switches.take("/w/a.code-workspace")).toBeUndefined()
  })

  test("carries whether the switching window showed the walkthrough", async function () {
    await switches.record("/w/a.code-workspace", { isWalkthroughOpen: true })

    expect(await switches.take("/w/a.code-workspace")).toEqual({ isWalkthroughOpen: true })
  })
})
