import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type WorkspaceManager from "../../api/workspaceManager"
import { openWorkspace } from "../../commands/openWorkspace"
import type Resources from "../../config/resources"
import { createMockActionContext } from "../mocks/actionContext"
import type { DialogMockValues } from "../mocks/dialog"
import { createDialogMock } from "../mocks/dialog"

// The mock exposes the open workspace as a prototype getter; an own data
// property shadows it.
function openWorkspaceFile(uri: vscode.Uri | undefined): void {
  Object.defineProperty(vscode.workspace, "workspaceFile", {
    value: uri,
    configurable: true,
    writable: true,
  })
}

suite("openWorkspace command", function () {
  const courseWorkspaceFile = "/tmc/workspaces/python-course.code-workspace"

  let dialogMock: Dialog
  let dialogMockValues: DialogMockValues
  let createWorkspaceFile: ReturnType<typeof vi.fn>
  let executeCommand: ReturnType<typeof vi.spyOn>

  function actionContext(): ReadyActionContext {
    return {
      ...createMockActionContext({
        startup: {
          resources: {
            getWorkspaceFilePath: () => courseWorkspaceFile,
          } as unknown as Resources,
          workspaceManager: { createWorkspaceFile } as unknown as WorkspaceManager,
        },
      }),
      dialog: dialogMock,
    }
  }

  beforeEach(function () {
    ;[dialogMock, dialogMockValues] = createDialogMock()
    createWorkspaceFile = vi.fn()
    executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
  })

  afterEach(function () {
    vi.restoreAllMocks()
    openWorkspaceFile(undefined)
  })

  test("focuses the explorer instead of reloading when the workspace is already open", async function () {
    openWorkspaceFile(vscode.Uri.file(courseWorkspaceFile))

    await openWorkspace(actionContext(), "python-course", "tmc")

    expect(dialogMock.confirmation).not.toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalledWith("vscode.openFolder", expect.anything())
    expect(executeCommand).toHaveBeenCalledWith("workbench.files.action.focusFilesExplorer")
  })

  test("opens the course workspace without asking when no workspace is open", async function () {
    openWorkspaceFile(undefined)

    await openWorkspace(actionContext(), "python-course", "tmc")

    expect(dialogMock.confirmation).not.toHaveBeenCalled()
    expect(executeCommand).toHaveBeenCalledWith(
      "vscode.openFolder",
      expect.objectContaining({ fsPath: courseWorkspaceFile }),
    )
  })

  test("reports a workspace file it cannot write, once, and opens nothing", async function () {
    openWorkspaceFile(undefined)
    const error = new Error("disk full")
    createWorkspaceFile.mockRejectedValue(error)

    await openWorkspace(actionContext(), "python-course", "mooc")

    expect(dialogMock.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to open the course workspace.",
      error,
      "mooc",
    )
    expect(executeCommand).not.toHaveBeenCalledWith("vscode.openFolder", expect.anything())
  })

  test("asks before closing a different workspace, and opens nothing when declined", async function () {
    openWorkspaceFile(vscode.Uri.file("/somewhere/else.code-workspace"))
    dialogMockValues.confirmation = false

    await openWorkspace(actionContext(), "python-course", "tmc")

    expect(dialogMock.confirmation).toHaveBeenCalled()
    expect(executeCommand).not.toHaveBeenCalledWith("vscode.openFolder", expect.anything())
    expect(dialogMock.warningNotification).toHaveBeenCalled()
  })
})
