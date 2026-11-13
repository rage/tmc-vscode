import type { Result } from "ts-results"
import { Ok } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { Warned } from "../api/withOperation"
import { failure } from "../api/withOperation"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { isSubmitRefusal } from "../errors"
import { runForExercise } from "./runForExercise"

/** Asks before the exercise's last try; `true` when there are more, or the student agrees. */
async function confirmLastTry(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<boolean> {
  const stored = actionContext.startup.userData.getExercise(exercise.id)
  if (
    !stored.ok ||
    stored.val.exercise.kind !== "mooc" ||
    stored.val.exercise.data.triesLeft !== 1
  ) {
    return true
  }
  return actionContext.dialog.confirm(
    `This is your last try on ${exercise.exerciseSlug}. Submit?`,
    {
      confirmLabel: "Submit",
      detail:
        "Its score is final after this submission. Run Tests checks your code without using a try.",
    },
  )
}

export async function submitExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<Result<Warned, Error>> {
  return runForExercise(
    actionContext,
    resource,
    "Submitting the exercise",
    async (exercise) => {
      if (!(await confirmLastTry(actionContext, exercise))) {
        return Ok({ warnings: [] })
      }
      const result = await actions.submitExercise(actionContext, exercise)
      if (result.err && isSubmitRefusal(result.val)) {
        // The course's rules, not a failure.
        void actionContext.dialog.notification(result.val.message)
        return Ok({ warnings: [] })
      }
      return result.err ? failure("Exercise submission failed.", result.val) : result
    },
    { trustedCommand: "tmc.submitExercise" },
  )
}
