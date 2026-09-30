import type { Result } from "ts-results"
import { Ok } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { exerciseActivity } from "../ui/statusBarActivity"
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
      const result = await exerciseActivity.run(exercise.uri, "submitting", () =>
        actions.submitExercise(context, actionContext, exercise),
      )
      return result.err ? failure("Exercise submission failed.", result.val) : result
    },
  )
  if (submitted.err) {
    return submitted
  }

  // Point totals come from the backend, so without this refresh the Courses view and
  // Course Details totals stay stale until the user refreshes by hand.
  await refreshEverything(actionContext, { silent: true, courseId: submitted.val })
  return Ok.EMPTY
}

/**
 * Waits again for the grading shown in submission panel `panelId`, then refreshes that
 * course's totals like {@link submitExercise}. Failures are the panel's to show.
 */
export async function keepWaitingForGrading(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  panelId: number,
): Promise<Result<void, Error>> {
  const wait = (): ReturnType<typeof actions.keepWaitingForGrading> =>
    actions.keepWaitingForGrading(context, actionContext, panelId)
  const exercise = actions.exerciseAwaitingGrading(panelId)
  const waited = exercise
    ? await exerciseActivity.run(exercise.uri, "submitting", wait)
    : await wait()
  if (waited.err) {
    return waited
  }
  await refreshEverything(actionContext, { silent: true, courseId: waited.val })
  return Ok.EMPTY
}
