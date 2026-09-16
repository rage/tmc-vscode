import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { runForExercise } from "./runForExercise"

export async function testExercise(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await runForExercise(actionContext, resource, "Testing the exercise", (exercise) =>
    actions.testExercise(context, actionContext, exercise),
  )
}
