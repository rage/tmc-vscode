import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { CheckstyleDiagnostics } from "../testing/checkstyleDiagnostics"
import { ExerciseTestController } from "../testing/exerciseTestController"
import { setActiveTestController } from "../testing/localTesting"

/**
 * Sets up the reporting of local test runs for the rest of the activation: the test
 * controller and the code quality diagnostics.
 */
export function registerTesting(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
): void {
  const { workspaceManager } = actionContext.startup
  const diagnostics = new CheckstyleDiagnostics()
  const controller = new ExerciseTestController(actionContext, diagnostics)
  const syncExercises = (): void => controller.syncExercises()
  context.subscriptions.push(
    diagnostics,
    controller,
    setActiveTestController(controller),
    workspaceManager.onDidChangeExercises(syncExercises),
    // Opening and closing exercises moves workspace folders without replacing the exercises.
    vscode.workspace.onDidChangeWorkspaceFolders(syncExercises),
  )
}
