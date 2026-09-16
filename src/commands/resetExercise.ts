import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import { backendName, ExerciseIdentifier } from "../shared/shared"
import { Logger, runSingleFlight } from "../utilities"
import { confirmSubmitBeforeDestructiveAction } from "./confirmSubmitBeforeDestructiveAction"
import { failure, runForExercise } from "./runForExercise"

/**
 * Resets an exercise to its initial state, optionally submitting it beforehand.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 */
export async function resetExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, langs, userData } = actionContext
  if (!(langs.ok && userData.ok)) {
    Logger.error("Extension was not initialized properly")
    return
  }

  await runForExercise(actionContext, resource, "Resetting the exercise", async (exercise) => {
    // Look up by known backend rather than a name-only match, which could
    // resolve to the wrong backend if a tmc and mooc exercise share a slug.
    const exerciseDetails =
      exercise.backend === "mooc"
        ? userData.val.getMoocExerciseByName(exercise.courseSlug, exercise.exerciseSlug)
        : userData.val.getTmcExerciseByName(exercise.courseSlug, exercise.exerciseSlug)
    if (!exerciseDetails) {
      return failure(`Missing exercise data for ${exercise.exerciseSlug}.`)
    }

    const id = ExerciseIdentifier.from(exerciseDetails.id)
    const submitFirst = await confirmSubmitBeforeDestructiveAction(
      actionContext,
      "Reset Exercise",
      backendName(id.kind),
    )
    if (submitFirst === undefined) {
      return Ok.EMPTY
    }

    // Key shared with the submit and paste actions: a reset overwrites the directory a
    // submission of the same exercise is reading, and with `submitFirst` it submits itself.
    return runSingleFlight(
      {
        key: `submit:${exercise.uri.fsPath}`,
        maxHoldMs: CLI_PROCESS_TIMEOUT + 30_000,
        busyMessage: "A submission for this exercise is already in progress.",
        onBusy: (message) => dialog.notification(message),
      },
      async () => {
        const editor = vscode.window.activeTextEditor
        const document = editor?.document.uri
        const resetResult = await langs.val.resetExercise(id, exercise.uri.fsPath, submitFirst)
        if (resetResult.err) {
          return failure("Failed to reset exercise.", resetResult.val)
        }

        if (editor && document) {
          Logger.debug(`Reopening original file "${document.fsPath}"`)
          await vscode.commands.executeCommand("workbench.action.files.revert", document)
        }
        return Ok.EMPTY
      },
    )
  })
}
