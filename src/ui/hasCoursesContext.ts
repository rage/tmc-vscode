import * as vscode from "vscode"

import type { UserData } from "../config/userdata"

const CONTEXT_KEY = "test-my-code:HasCourses"

/**
 * Keeps `test-my-code:HasCourses` true exactly while the user has a stored course, which is
 * what completes the walkthrough's "Add a course" step.
 */
export function trackHasCourses(
  userData: Pick<UserData, "getCourses" | "onDidChangeCourses">,
): vscode.Disposable {
  let applied: boolean | undefined
  const update = (): void => {
    const hasCourses = userData.getCourses().length > 0
    if (hasCourses !== applied) {
      applied = hasCourses
      void vscode.commands.executeCommand("setContext", CONTEXT_KEY, hasCourses)
    }
  }
  const subscription = userData.onDidChangeCourses(update)
  update()
  return subscription
}
