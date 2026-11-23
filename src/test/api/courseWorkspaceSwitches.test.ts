import * as fs from "fs"
import * as path from "path"

import * as tmp from "tmp"

import { CourseWorkspaceSwitches } from "../../api/courseWorkspaceSwitches"

suite("CourseWorkspaceSwitches", function () {
  let now: number
  let globalStorage: string
  let switches: CourseWorkspaceSwitches

  beforeEach(function () {
    now = 0
    globalStorage = path.join(tmp.dirSync({ unsafeCleanup: true }).name, "globalStorage")
    switches = new CourseWorkspaceSwitches(globalStorage, () => now)
  })

  test("the window a switch opens finds it, once", async function () {
    await switches.record("/w/a.code-workspace", {
      isWalkthroughOpen: false,
      aiOffSettingsWritten: [],
    })
    const openedWindow = new CourseWorkspaceSwitches(globalStorage, () => now)

    expect(await openedWindow.take("/w/a.code-workspace")).toEqual({
      isWalkthroughOpen: false,
      aiOffSettingsWritten: [],
    })
    expect(await openedWindow.take("/w/a.code-workspace")).toBeUndefined()
  })

  test("a switch record that cannot be read counts as none", async function () {
    fs.mkdirSync(globalStorage, { recursive: true })
    fs.writeFileSync(path.join(globalStorage, "course-workspace-switch.json"), "{")

    expect(await switches.take("/w/a.code-workspace")).toBeUndefined()
  })

  test("a switch that cannot be recorded still lets the switch go ahead", async function () {
    fs.mkdirSync(path.dirname(globalStorage), { recursive: true })
    fs.writeFileSync(globalStorage, "not a folder")

    await switches.record("/w/a.code-workspace", {
      isWalkthroughOpen: false,
      aiOffSettingsWritten: [],
    })

    expect(await switches.take("/w/a.code-workspace")).toBeUndefined()
  })

  // Another window may start before the one the switch opens.
  test("another window neither finds the switch nor takes it away", async function () {
    await switches.record("/w/a.code-workspace", {
      isWalkthroughOpen: false,
      aiOffSettingsWritten: [],
    })

    expect(await switches.take("/w/b.code-workspace")).toBeUndefined()
    expect(await switches.take(undefined)).toBeUndefined()
    expect(await switches.take("/w/a.code-workspace")).toBeDefined()
  })

  test("a switch minutes old no longer counts", async function () {
    await switches.record("/w/a.code-workspace", {
      isWalkthroughOpen: false,
      aiOffSettingsWritten: [],
    })
    now = 3 * 60 * 1000

    expect(await switches.take("/w/a.code-workspace")).toBeUndefined()
  })

  test("carries whether the switching window showed the walkthrough", async function () {
    await switches.record("/w/a.code-workspace", {
      isWalkthroughOpen: true,
      aiOffSettingsWritten: [],
    })

    expect(await switches.take("/w/a.code-workspace")).toEqual({
      isWalkthroughOpen: true,
      aiOffSettingsWritten: [],
    })
  })

  test("carries the AI-off settings the switching window wrote", async function () {
    const state = { isWalkthroughOpen: false, aiOffSettingsWritten: ["chat.disableAIFeatures"] }
    await switches.record("/w/a.code-workspace", state)

    expect(await switches.take("/w/a.code-workspace")).toEqual(state)
  })
})
