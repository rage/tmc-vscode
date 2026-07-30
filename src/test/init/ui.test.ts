import { Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { registerUiActions } from "../../init/ui"
import type UI from "../../ui/ui"
import { createMockActionContext } from "../mocks/actionContext"

interface RegisteredAction {
  label: string
  id: string
  groups: unknown[]
  command: vscode.Command
}

function registerAndCollect(): RegisteredAction[] {
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
    userData: Ok({ getCourses: () => [] }) as never,
    // `registerUiActions` short-circuits into the initialization-error entries
    // unless every one of these is Ok.
    langs: Ok({}) as never,
    resources: Ok({}) as never,
    exerciseDecorationProvider: Ok({}) as never,
    workspaceManager: Ok({}) as never,
    visibilityGroups: { loggedIn } as never,
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
})
