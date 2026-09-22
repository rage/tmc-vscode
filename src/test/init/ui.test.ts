import { vi } from "vitest"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import { registerCommands, registerServiceFreeCommands } from "../../init/commands"
import { registerUiActions } from "../../init/ui"
import { CourseIdentifier, makeMoocKind, makeTmcKind } from "../../shared/shared"
import type { TreeEntry } from "../../ui/treeview/treeview"
import type UI from "../../ui/ui"
import { createDegradedContext, createMockActionContext } from "../mocks/actionContext"

function readyContext(courses: unknown[] = []): ActionContext {
  return createMockActionContext({ startup: { userData: { getCourses: () => courses } as never } })
}

function registerAndCollect(actionContext: ActionContext = readyContext()): TreeEntry[] {
  const entries: TreeEntry[] = []
  const registerAction = vi.fn((entry: TreeEntry) => {
    entries.push(entry)
  })
  const ui = { treeDP: { registerAction } } as unknown as UI

  registerUiActions({ ...actionContext, ui })
  return entries
}

function registeredCommandIds(actionContext: ActionContext): string[] {
  const ids: string[] = []
  const registerCommand = vi.spyOn(vscode.commands, "registerCommand").mockImplementation(((
    id: string,
  ) => {
    ids.push(id)
    return { dispose: vi.fn() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)
  const context = {
    subscriptions: [],
    extensionUri: vscode.Uri.file("/tmp/extension"),
  } as unknown as vscode.ExtensionContext

  registerServiceFreeCommands(context, actionContext.dialog, actionContext.ui)
  registerCommands(context, actionContext)
  registerCommand.mockRestore()
  return ids
}

suite("registerUiActions", function () {
  // The tree view is the entry point for a user with no credentials at all, so it
  // must point at the courses.mooc.fi device flow -- the only login left.
  test("the Log in entry runs the mooc device-flow login", function () {
    const logIn = registerAndCollect().find((entry) => entry.id === "logIn")
    expect(logIn?.label).toBe("Log in")
    expect(logIn?.command.command).toBe("tmc.showMoocLogin")
  })

  test("the Log in entry is shown only while logged out", function () {
    const entries = registerAndCollect()
    const logIn = entries.find((entry) => entry.id === "logIn")
    const logOut = entries.find((entry) => entry.id === "logOut")
    expect(logIn?.visible).toBe("loggedOut")
    expect(logOut?.visible).toBe("loggedIn")
  })

  // The tree is the one place a course is labelled, and it shows the title (the slug
  // belongs to paths, workspace file names and setting keys) plus which backend it is
  // on, the same way every other course picker does.
  test("courses are listed under My Courses by title, on both backends", function () {
    const courses = [
      makeTmcKind({ id: 1, name: "tmc-slug", title: "The Python Course" }),
      makeMoocKind({ id: "course-uuid", name: "mooc-slug", title: "Introduction to CS" }),
    ]
    const myCourses = registerAndCollect(readyContext(courses)).find(
      (entry) => entry.id === "myCourses",
    )

    expect(myCourses?.children?.()).toEqual([
      {
        label: "The Python Course",
        description: "TMC Server",
        id: "1",
        command: expect.objectContaining({
          command: "tmc.courseDetails",
          arguments: [CourseIdentifier.from(1)],
        }),
      },
      {
        label: "Introduction to CS",
        description: "courses.mooc.fi",
        id: "course-uuid",
        command: expect.objectContaining({
          command: "tmc.courseDetails",
          arguments: [CourseIdentifier.from("course-uuid")],
        }),
      },
    ])
  })

  // A failed activation is the one state whose entire remaining purpose is to let the
  // user diagnose or restart; an empty tree leaves nothing to click.
  test("a failed initialization still offers the entries that diagnose it", function () {
    const ids = registerAndCollect(createDegradedContext()).map((entry) => entry.id)

    expect(ids).toContain("tmc.viewInitializationErrorHelp")
    expect(ids).toContain("workbench.action.restartExtensionHost")
    expect(ids).toContain("logs")
    expect(ids).toContain("settings")
  })

  test("the healthy tree offers no recovery entries", function () {
    const ids = registerAndCollect().map((entry) => entry.id)
    expect(ids).not.toContain("tmc.viewInitializationErrorHelp")
    expect(ids).not.toContain("workbench.action.restartExtensionHost")
  })

  // `TmcMenuTree.registerAction` throws on a repeated id, which aborts activation
  // outright, and the two menus share the entries that need no service.
  test.for([
    ["a ready", readyContext()],
    ["a degraded", createDegradedContext()],
  ] as const)("%s startup registers no entry twice", function ([, actionContext]) {
    const ids = registerAndCollect(actionContext).map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // An entry whose command the same startup state leaves unregistered is a button that
  // answers "command not found"; the two registrations are written apart and drift.
  test.for([
    ["a ready", readyContext()],
    ["a degraded", createDegradedContext()],
  ] as const)("%s startup offers no entry it cannot run", function ([, actionContext]) {
    const registered = new Set(registeredCommandIds(actionContext))
    const unrunnable = registerAndCollect(actionContext)
      .map((entry) => entry.command.command)
      // VS Code's own, so it is always there and this extension never registers it.
      .filter((command) => command !== "workbench.action.restartExtensionHost")
      .filter((command) => !registered.has(command))

    expect(unrunnable).toEqual([])
  })
})
