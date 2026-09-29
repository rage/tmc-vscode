import type { Result } from "ts-results"
import { Ok } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { refreshEverything } from "./refreshEverything"
import { runForExercise } from "./runForExercise"

export async function submitExercise(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<Result<void, Error>> {
  const submitted = await runForExercise(
    actionContext,
    resource,
    "Submitting the exercise",
    async (exercise) => {
      const result = await actions.submitExercise(context, actionContext, exercise)
      return result.err ? failure("Exercise submission failed.", result.val) : result
    },
  )
  if (submitted.err) {
    return submitted
  }

  // Point totals come from the backend, so without this refresh the CourseDetails and
  // MyCourses totals stay stale until the user refreshes by hand.
  await refreshEverything(actionContext, { silent: true, courseId: submitted.val })
  return Ok.EMPTY
}
