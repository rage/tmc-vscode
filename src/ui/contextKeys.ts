import * as vscode from "vscode"

import type WorkspaceManager from "../api/workspaceManager"
import type { UserData } from "../config/userdata"

/**
 * Keeps the `when`-clause context `key` equal to `compute()`, re-evaluated on each of
 * `events` and written only when it changes.
 */
export function trackContextKey(
  key: string,
  compute: () => boolean,
  events: vscode.Event<unknown>[],
): vscode.Disposable {
  let applied: boolean | undefined
  const update = (): void => {
    const value = compute()
    if (value !== applied) {
      applied = value
      void vscode.commands.executeCommand("setContext", key, value)
    }
  }
  const subscriptions = events.map((event) => event(update))
  update()
  return vscode.Disposable.from(...subscriptions)
}

/**
 * Keeps `test-my-code:ActiveEditorIsExercise` true exactly while the active editor shows a
 * file inside a known exercise, which is what gates the exercise actions on the editor.
 */
export function trackActiveEditorExercise(
  workspaceManager: Pick<WorkspaceManager, "activeExercise" | "onDidChangeExercises">,
): vscode.Disposable {
  return trackContextKey(
    "test-my-code:ActiveEditorIsExercise",
    () => workspaceManager.activeExercise !== undefined,
    [vscode.window.onDidChangeActiveTextEditor, workspaceManager.onDidChangeExercises],
  )
}

/**
 * Keeps `test-my-code:HasCourses` true exactly while the user has a stored course, which is
 * what completes the walkthrough's "Add a course" step.
 */
export function trackHasCourses(
  userData: Pick<UserData, "getCourses" | "onDidChangeCourses">,
): vscode.Disposable {
  return trackContextKey("test-my-code:HasCourses", () => userData.getCourses().length > 0, [
    userData.onDidChangeCourses,
  ])
}
