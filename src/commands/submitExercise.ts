import type { Result } from "ts-results"
import { Ok } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { Warned } from "../api/withOperation"
import { failure } from "../api/withOperation"
import { OutOfTriesError } from "../errors"
import { runForExercise } from "./runForExercise"

export async function submitExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<Result<Warned, Error>> {
  return runForExercise(actionContext, resource, "Submitting the exercise", async (exercise) => {
    const result = await actions.submitExercise(actionContext, exercise)
    if (result.err && result.val instanceof OutOfTriesError) {
      // A final score, not a failure.
      void actionContext.dialog.notification(result.val.message)
      return Ok({ warnings: [] })
    }
    return result.err ? failure("Exercise submission failed.", result.val) : result
  })
}
