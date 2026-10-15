import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type { CourseWorkspaceSwitches } from "../../api/courseWorkspaceSwitches"
import type Dialog from "../../api/dialog"
import type WorkspaceManager from "../../api/workspaceManager"
import { openWorkspace } from "../../commands/openWorkspace"
import type Resources from "../../config/resources"
import { tmcLocalCourse } from "../fixtures/courses"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

/** Stubs one `vscode.workspace` member, which the mock exposes as a prototype getter. */
function stubWorkspace(key: "workspaceFile" | "workspaceFolders" | "name", value: unknown): void {
  Object.defineProperty(vscode.workspace, key, { value, configurable: true, writable: true })
}

const course = tmcLocalCourse({ name: "python-course", title: "Python Course" })

suite("openWorkspace command", function () {
  const courseWorkspaceFile = "/tmc/workspaces/python-course.code-workspace"

  let dialogMock: Dialog
  let createWorkspaceFile: ReturnType<typeof vi.fn>
  let recordSwitch: ReturnType<typeof vi.fn>
  let executeCommand: ReturnType<typeof vi.spyOn>
  let activeCourse: string | undefined

  function actionContext(): ReadyActionContext {
    return {
      ...createMockActionContext({
        startup: {
          courseWorkspaceSwitches: {
            record: recordSwitch,
          } as unknown as CourseWorkspaceSwitches,
          resources: {
            getWorkspaceFilePath: () => courseWorkspaceFile,
          } as unknown as Resources,
          workspaceManager: { createWorkspaceFile, activeCourse } as unknown as WorkspaceManager,
        },
      }),
      dialog: dialogMock,
    }
  }

  function openedFolder(): unknown[] | undefined {
    return executeCommand.mock.calls.find((call: unknown[]) => call[0] === "vscode.openFolder")
  }

  beforeEach(function () {
    ;[dialogMock] = createDialogMock()
    createWorkspaceFile = vi.fn()
    recordSwitch = vi.fn()
    activeCourse = undefined
    executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    stubWorkspace("workspaceFile", undefined)
    stubWorkspace("workspaceFolders", undefined)
    stubWorkspace("name", undefined)
  })

  afterEach(function () {
    vi.restoreAllMocks()
    stubWorkspace("workspaceFile", undefined)
    stubWorkspace("workspaceFolders", undefined)
    stubWorkspace("name", undefined)
  })

  test("focuses the explorer instead of reloading when the workspace is already open", async function () {
    stubWorkspace("workspaceFile", vscode.Uri.file(courseWorkspaceFile))

    await openWorkspace(actionContext(), course)

    expect(dialogMock.choose).not.toHaveBeenCalled()
    expect(openedFolder()).toBeUndefined()
    expect(executeCommand).toHaveBeenCalledWith("workbench.files.action.focusFilesExplorer")
  })

  test("opens the course workspace without asking in an empty window", async function () {
    await openWorkspace(actionContext(), course)

    expect(dialogMock.choose).not.toHaveBeenCalled()
    expect(openedFolder()).toEqual([
      "vscode.openFolder",
      expect.objectContaining({ fsPath: vscode.Uri.file(courseWorkspaceFile).fsPath }),
      { forceNewWindow: false },
    ])
  })

  // Course workspaces save on focus change, so leaving one loses nothing.
  test("switches from another course's workspace without asking", async function () {
    stubWorkspace("workspaceFile", vscode.Uri.file("/tmc/workspaces/other.code-workspace"))
    activeCourse = "other"

    await openWorkspace(actionContext(), course)

    expect(dialogMock.choose).not.toHaveBeenCalled()
    expect(openedFolder()).toBeDefined()
  })

  test("remembers the switch for the window it opens", async function () {
    await openWorkspace(actionContext(), course)

    expect(recordSwitch).toHaveBeenCalledWith(vscode.Uri.file(courseWorkspaceFile).fsPath)
  })

  test("asks, naming the course and the folder, before closing the student's own folder", async function () {
    stubWorkspace("workspaceFolders", [{ uri: vscode.Uri.file("/home/me/project"), index: 0 }])
    stubWorkspace("name", "project")
    vi.mocked(dialogMock.choose).mockResolvedValue("newWindow")

    await openWorkspace(actionContext(), course)

    expect(dialogMock.choose).toHaveBeenCalledWith(
      "Open the Python Course course workspace?",
      { detail: "project will close in this window." },
      ["Open Here", "here"],
      ["Open in New Window", "newWindow"],
    )
    expect(openedFolder()?.[2]).toEqual({ forceNewWindow: true })
  })

  test("opens nothing when the student declines", async function () {
    stubWorkspace("workspaceFile", vscode.Uri.file("/somewhere/else.code-workspace"))
    vi.mocked(dialogMock.choose).mockResolvedValue(undefined)

    await openWorkspace(actionContext(), course)

    expect(openedFolder()).toBeUndefined()
    // Declining is the answer; a toast offering the declined action again is not.
    expect(dialogMock.warningNotification).not.toHaveBeenCalled()
  })

  test("reports a workspace file it cannot write, once, and opens nothing", async function () {
    const error = new Error("disk full")
    createWorkspaceFile.mockRejectedValue(error)

    await openWorkspace(actionContext(), course)

    expect(dialogMock.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to open the course workspace.",
      error,
    )
    expect(openedFolder()).toBeUndefined()
  })
})
