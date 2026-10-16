import * as vscode from "vscode"

import { Logger } from "../utilities"
import { closeTrustEditorWhenTrusted } from "../window/workspaceTrustEditor"

/**
 * How long VS Code's own startup trust modal may take to appear once the window has focus. A
 * request made while that modal is pending joins it; one made before it shows a second modal.
 */
const STARTUP_MODAL_SETTLE_MS = 2000

/** A trust request that settles faster than this showed no dialog. */
const NO_DIALOG_MS = 300

/** A task type no provider contributes, so that fetching it only asks for trust. */
const TRUST_REQUEST_TASK_TYPE = "testMyCode.workspaceTrust"

/**
 * Asks the student to trust the untrusted course workspace this window has open, through VS Code's
 * own trust modal. Does nothing in a trusted window. Settles once the question is answered or
 * dismissed, so activation must not await it.
 *
 * Where VS Code asks on startup by itself, this waits for that question and joins it rather than
 * asking twice; elsewhere it explains first why TestMyCode needs trust.
 */
export async function promptForCourseWorkspaceTrust(courseTitle: string): Promise<void> {
  if (vscode.workspace.isTrusted) {
    return
  }
  const startupPrompt = vscode.workspace
    .getConfiguration("security.workspace.trust")
    .get<string>("startupPrompt")
  if (startupPrompt !== "never") {
    await windowFocus()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, STARTUP_MODAL_SETTLE_MS)
    })
    if (!vscode.workspace.isTrusted) {
      await requestWorkspaceTrust()
    }
    return
  }

  const trust = "Trust Course Workspace"
  const pick = await vscode.window.showWarningMessage(
    `Trust ${courseTitle} to run tests and submit`,
    {
      modal: true,
      detail:
        "TestMyCode runs your exercise code, which VS Code allows only in a trusted workspace." +
        " VS Code asks next: choose Trust Workspace & Continue.",
    },
    trust,
  )
  if (pick === trust) {
    await requestWorkspaceTrust()
  }
}

/**
 * Shows VS Code's own modal asking to trust the open workspace, or the Workspace Trust editor
 * where no modal comes up. Settles once the student has answered.
 */
export async function requestWorkspaceTrust(): Promise<void> {
  // VS Code's modal offers Manage, which opens the editor, as does the fallback below.
  closeTrustEditorWhenTrusted()
  const askedAt = Date.now()
  // The only stable API that reaches the trust modal: listing tasks asks for trust first.
  await vscode.tasks.fetchTasks({ type: TRUST_REQUEST_TASK_TYPE })
  if (!vscode.workspace.isTrusted && Date.now() - askedAt < NO_DIALOG_MS) {
    Logger.warn("Listing tasks did not ask for workspace trust; opening the trust editor.")
    await vscode.commands.executeCommand("workbench.trust.manage")
  }
}

function windowFocus(): Promise<void> {
  if (vscode.window.state.focused) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const listener = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        listener.dispose()
        resolve()
      }
    })
  })
}
