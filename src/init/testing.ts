import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { CheckstyleDiagnostics } from "../testing/checkstyleDiagnostics"
import { setActiveLocalTesting } from "../testing/localTesting"
import { openCourseExercises } from "../testing/openExercises"

/** Sets up how local test runs are reported in the editor, for the rest of the activation. */
export function registerTesting(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
): void {
  const { workspaceManager } = actionContext.startup
  const diagnostics = new CheckstyleDiagnostics()
  const clearClosedExercises = (): void =>
    diagnostics.retain(openCourseExercises(workspaceManager).map((exercise) => exercise.uri))
  context.subscriptions.push(
    diagnostics,
    setActiveLocalTesting({ diagnostics }),
    workspaceManager.onDidChangeExercises(clearClosedExercises),
    vscode.workspace.onDidChangeWorkspaceFolders(clearClosedExercises),
  )
}
