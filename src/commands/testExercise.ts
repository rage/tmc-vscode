import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { runForExercise } from "./runForExercise"

export async function testExercise(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await runForExercise(actionContext, resource, "Testing the exercise", async (exercise) => {
    const result = await actions.testExercise(context, actionContext, exercise)
    return result.err ? failure("Exercise test run failed.", result.val) : result
  })
}
