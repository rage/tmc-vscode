import type { Result } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure, runForExercise } from "./runForExercise"

export async function submitExercise(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<Result<void, Error>> {
  return runForExercise(actionContext, resource, "Submitting the exercise", async (exercise) => {
    const result = await actions.submitExercise(context, actionContext, exercise)
    return result.err ? failure("Exercise submission failed.", result.val) : result
  })
}
