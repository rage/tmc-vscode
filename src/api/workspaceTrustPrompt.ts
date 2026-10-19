import * as vscode from "vscode"

import { Logger } from "../utilities"
import { closeTrustEditorWhenTrusted } from "../window/workspaceTrustEditor"

/** Marks a workspace that has opened untrusted before, in its `workspaceState`. */
const OPENED_UNTRUSTED_KEY = "workspaceTrust.openedUntrusted"

/** A trust request that settles faster than this showed no dialog. */
const NO_DIALOG_MS = 300

/** A task type no provider contributes, so that fetching it only asks for trust. */
const TRUST_REQUEST_TASK_TYPE = "testMyCode.workspaceTrust"

/**
 * Asks the student to trust the untrusted course workspace this window has open, through VS Code's
 * own trust modal. Does nothing in a trusted window. Settles once the question is answered or
 * dismissed, so activation must not await it.
 *
 * Asks nothing where VS Code asks on this startup by itself: always with `startupPrompt` "always",
 * and on a workspace's first untrusted opening with "once". A request made around VS Code's own
 * question would ask a student who has just answered it a second time. Elsewhere it explains first
 * why TestMyCode needs trust.
 *
 * @param workspaceState Where this records that the workspace has opened untrusted.
 */
export async function promptForCourseWorkspaceTrust(
  courseTitle: string,
  workspaceState: vscode.Memento,
): Promise<void> {
  if (vscode.workspace.isTrusted) {
    return
  }
  const startupPrompt = vscode.workspace
    .getConfiguration("security.workspace.trust")
    .get<string>("startupPrompt")
  if (startupPrompt === "always") {
    return
  }
  if (startupPrompt !== "never") {
    // Mirrors VS Code's own record of having asked, which it keeps per workspace as well.
    const hasOpenedUntrusted = workspaceState.get<boolean>(OPENED_UNTRUSTED_KEY) === true
    await workspaceState.update(OPENED_UNTRUSTED_KEY, true)
    if (!hasOpenedUntrusted) {
      return
    }
    await windowFocus()
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
  Logger.info("Requesting workspace trust.")
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
