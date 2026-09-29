import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { CheckstyleDiagnostics } from "../testing/checkstyleDiagnostics"
import { ExerciseTestController } from "../testing/exerciseTestController"
import { setActiveTestController } from "../testing/localTesting"

/**
 * Sets up the reporting of local test runs for the rest of the activation: the test
 * controller, the code quality diagnostics, and the test item commands.
 */
export function registerTesting(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
): void {
  const { workspaceManager } = actionContext.startup
  const diagnostics = new CheckstyleDiagnostics()
  const controller = new ExerciseTestController(actionContext, diagnostics)
  const syncExercises = (): void => controller.syncExercises()
  // The test item menus hand over the item, which the exercise commands would read as a path.
  const forwardToExercise =
    (command: string) =>
    (item: vscode.TestItem | undefined): Thenable<unknown> =>
      vscode.commands.executeCommand(command, controller.exerciseUriOf(item))
  context.subscriptions.push(
    diagnostics,
    controller,
    setActiveTestController(controller),
    workspaceManager.onDidChangeExercises(syncExercises),
    // Opening and closing exercises moves workspace folders without replacing the exercises.
    vscode.workspace.onDidChangeWorkspaceFolders(syncExercises),
    vscode.commands.registerCommand(
      "tmc.testing.submitExercise",
      forwardToExercise("tmc.submitExercise"),
    ),
    vscode.commands.registerCommand(
      "tmc.testing.pasteExercise",
      forwardToExercise("tmc.pasteExercise"),
    ),
  )
}
