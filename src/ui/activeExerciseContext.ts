import * as vscode from "vscode"

import type WorkspaceManager from "../api/workspaceManager"

const CONTEXT_KEY = "test-my-code:ActiveEditorIsExercise"

/**
 * Keeps `test-my-code:ActiveEditorIsExercise` true exactly while the active editor shows a
 * file inside a known exercise, which is what gates the exercise actions on the editor.
 */
export function trackActiveEditorExercise(
  workspaceManager: Pick<WorkspaceManager, "activeExercise" | "onDidChangeExercises">,
): vscode.Disposable {
  let applied: boolean | undefined
  const update = (): void => {
    const isExercise = workspaceManager.activeExercise !== undefined
    if (isExercise !== applied) {
      applied = isExercise
      void vscode.commands.executeCommand("setContext", CONTEXT_KEY, isExercise)
    }
  }
  const subscriptions = [
    vscode.window.onDidChangeActiveTextEditor(update),
    workspaceManager.onDidChangeExercises(update),
  ]
  update()
  return vscode.Disposable.from(...subscriptions)
}
