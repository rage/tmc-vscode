import type { Result } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { failure, runForExercise } from "./runForExercise"

export async function submitExercise(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<Result<void, Error>> {
  return runForExercise(actionContext, resource, "Submitting the exercise", async (exercise) => {
    const result =
      exercise.backend === "mooc"
        ? await actions.submitMoocExercise(context, actionContext, exercise)
        : await actions.submitTmcExercise(context, actionContext, exercise)
    return result.err ? failure("Exercise submission failed.", result.val) : result
  })
}
