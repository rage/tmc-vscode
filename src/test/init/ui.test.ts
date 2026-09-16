import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import { registerUiActions } from "../../init/ui"
import type UI from "../../ui/ui"
import { createMockActionContext } from "../mocks/actionContext"

interface RegisteredAction {
  label: string
  id: string
  groups: unknown[]
  command: vscode.Command
}

const healthyResults = {
  userData: Ok({ getCourses: () => [] }) as never,
  langs: Ok({}) as never,
  resources: Ok({}) as never,
  exerciseDecorationProvider: Ok({}) as never,
  workspaceManager: Ok({}) as never,
}

function registerAndCollect(overrides: Partial<ActionContext> = {}): RegisteredAction[] {
  const actions: RegisteredAction[] = []
  const registerAction = vi.fn(
    (label: string, id: string, groups: unknown[], command: vscode.Command) => {
      actions.push({ label, id, groups, command })
    },
  )
  const ui = { treeDP: { registerAction } } as unknown as UI
  const loggedIn = { id: 1, not: { id: 1, negated: true } }

  registerUiActions({
    ...createMockActionContext(),
    ui,
    ...healthyResults,
    visibilityGroups: { loggedIn } as never,
    ...overrides,
  })
  return actions
}

suite("registerUiActions", function () {
  // The tree view is the entry point for a user with no credentials at all, so it
  // must point at the courses.mooc.fi device flow -- the only login left.
  test("the Log in entry runs the mooc device-flow login", function () {
    const logIn = registerAndCollect().find((action) => action.id === "logIn")
    expect(logIn?.label).toBe("Log in")
    expect(logIn?.command.command).toBe("tmc.showMoocLogin")
  })

  test("the Log in entry is shown only while logged out", function () {
    const actions = registerAndCollect()
    const logIn = actions.find((action) => action.id === "logIn")
    const logOut = actions.find((action) => action.id === "logOut")
    expect(logIn?.groups).toEqual([{ id: 1, negated: true }])
    expect(logOut?.groups).toEqual([{ id: 1, not: { id: 1, negated: true } }])
  })

  // A failed activation is the one state whose entire remaining purpose is to let the
  // user diagnose or restart; an empty tree leaves nothing to click.
  test("a failed initialization still offers the entries that diagnose it", function () {
    const failure = Err(new Error("resource initialization failed")) as never
    const ids = registerAndCollect({
      userData: failure,
      resources: failure,
      workspaceManager: failure,
      exerciseDecorationProvider: failure,
    }).map((action) => action.id)

    expect(ids).toContain("tmc.viewInitializationErrorHelp")
    expect(ids).toContain("workbench.action.restartExtensionHost")
    expect(ids).toContain("logs")
    expect(ids).toContain("settings")
  })

  test("the healthy tree offers no recovery entries", function () {
    const ids = registerAndCollect().map((action) => action.id)
    expect(ids).not.toContain("tmc.viewInitializationErrorHelp")
    expect(ids).not.toContain("workbench.action.restartExtensionHost")
  })

  // `Visibility.registerAction` throws on a repeated id, which aborts activation
  // outright -- so no combination of initialization results may reach one twice.
  test("no entry is registered twice in any combination of initialization results", function () {
    const fields = Object.keys(healthyResults) as (keyof typeof healthyResults)[]
    for (let failed = 0; failed < 1 << fields.length; failed++) {
      const overrides: Partial<ActionContext> = {}
      fields.forEach((field, index) => {
        if (failed & (1 << index)) {
          overrides[field] = Err(new Error(`${field} failed`)) as never
        }
      })

      const ids = registerAndCollect(overrides).map((action) => action.id)
      expect(new Set(ids).size, `duplicate entry for ${JSON.stringify(overrides)}`).toBe(ids.length)
    }
  })
})
