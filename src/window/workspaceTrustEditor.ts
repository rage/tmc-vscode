import * as vscode from "vscode"

/** The Workspace Trust editor's tab label; in another display language it is not matched. */
const TRUST_EDITOR_LABEL = "Workspace Trust"

let pendingClose: vscode.Disposable | undefined

/**
 * Closes the Workspace Trust editor when the workspace is next trusted, if it is the active
 * editor then. VS Code keeps it open after Trust, from 1.137 on as an overlay on the window.
 */
export function closeTrustEditorWhenTrusted(): void {
  pendingClose?.dispose()
  pendingClose = vscode.workspace.onDidGrantWorkspaceTrust(() => {
    pendingClose?.dispose()
    pendingClose = undefined
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    // A tab VS Code gives extensions no input for, unlike every editor of a file.
    if (tab?.label === TRUST_EDITOR_LABEL && tab.input === undefined) {
      void vscode.window.tabGroups.close(tab)
    }
  })
}
