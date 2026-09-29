import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { PickableSubmission } from "../actions"
import { listOldSubmissions, restoreOldSubmission } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { BottleneckError } from "../errors"
import type { MoocOldSubmissionRestore } from "../shared/langsSchema"
import { backendName, ExerciseIdentifier } from "../shared/shared"
import { dateToString, Logger, parseDate } from "../utilities"
import { confirmSubmitBeforeDestructiveAction } from "./confirmSubmitBeforeDestructiveAction"
import { runForExercise } from "./runForExercise"

const TITLE = "Download Old Submission"

/**
 * Lets the user pick one of an exercise's earlier submissions and restores it
 * over the exercise's current state, optionally submitting that state first.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 */
export async function downloadOldSubmission(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  await runForExercise(
    actionContext,
    resource,
    "Downloading the old submission",
    async (exercise) => {
      // Look up by known backend rather than a name-only match, which could
      // resolve to the wrong backend if a tmc and mooc exercise share a slug.
      const exerciseId =
        exercise.backend === "mooc"
          ? userData.getMoocExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id
          : userData.getTmcExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id
      if (!exerciseId) {
        return failure("Failed to resolve exercise id.")
      }

      const id = ExerciseIdentifier.from(exerciseId)
      Logger.debug("Fetching old submissions")
      const submissionsResult = await listOldSubmissions(actionContext, id)
      if (submissionsResult.err) {
        return failure("Failed to fetch old submissions.", submissionsResult.val)
      }

      submissionsResult.val.sort(
        (a, b) =>
          (parseDate(a.createdAt)?.getTime() ?? 0) - (parseDate(b.createdAt)?.getTime() ?? 0),
      )
      if (submissionsResult.val.length === 0) {
        dialog.notification(`No previous submissions found for exercise ${exercise.exerciseSlug}`)
        return Ok.EMPTY
      }

      const submission = await dialog.selectItem(
        {
          title: TITLE,
          placeHolder: exercise.exerciseSlug + ": Select a submission",
        },
        ...submissionsResult.val.map<[string, PickableSubmission]>((pickable) => {
          const createdAt = parseDate(pickable.createdAt)
          return [`${createdAt ? dateToString(createdAt) : ""}| ${pickable.status}`, pickable]
        }),
      )
      if (!submission) {
        return Ok.EMPTY
      }

      const submitFirst = await confirmSubmitBeforeDestructiveAction(
        actionContext,
        TITLE,
        backendName(id.kind),
      )
      if (submitFirst === undefined) {
        return Ok.EMPTY
      }

      const editor = vscode.window.activeTextEditor
      const document = editor?.document.uri
      const restoreResult: Result<MoocOldSubmissionRestore, Error> = await restoreOldSubmission(
        actionContext,
        exercise.uri.fsPath,
        submission.target,
        submitFirst,
      )
      // A busy rejection means the restore never ran, so there is nothing on disk to
      // revert the editor to.
      if (
        editor &&
        document &&
        !(restoreResult.err && restoreResult.val instanceof BottleneckError)
      ) {
        await vscode.commands.executeCommand("workbench.action.files.revert", document)
      }
      if (restoreResult.err) {
        return failure("Failed to download old submission.", restoreResult.val)
      }
      if (restoreResult.val === "nothing-to-download") {
        // Reachable only for an exercise type with no files at all, so never for a tmc
        // exercise. Nothing was changed, so this is ordinary news rather than a failure.
        dialog.notification("That submission has no files to download.")
      }
      return Ok.EMPTY
    },
  )
}
