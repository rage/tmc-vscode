import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { MoocOldSubmissionRestore } from "../../shared/langsSchema"
import type { PickableSubmission } from "../actions"
import { checkAiUse, listOldSubmissions, restoreOldSubmission } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { Item } from "../api/dialog"
import { failure } from "../api/withOperation"
import { formatTimestamp, parseDate } from "../utilities"
import { revertExerciseDocuments } from "../window/exerciseDocuments"
import {
  confirmSubmitBeforeDestructiveAction,
  keepingVerb,
} from "./confirmSubmitBeforeDestructiveAction"
import { checkTrustRetrying, runForExercise } from "./runForExercise"

const TITLE = "Download Old Submission"

/**
 * Picker rows for `submissions`, newest first. The newest graded submission, the one a student
 * almost always wants, is marked; a newer backup or paste is not.
 */
function submissionItems(submissions: PickableSubmission[]): Item<PickableSubmission>[] {
  const now = new Date()
  const sorted = submissions
    .map((submission) => ({ submission, createdAt: parseDate(submission.createdAt) }))
    .toSorted((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
  const latest = sorted.find(({ submission }) => submission.kind === "submission")?.submission
  return sorted.map(({ submission, createdAt }) => {
    const item: Item<PickableSubmission> = {
      label: createdAt ? formatTimestamp(createdAt, now, vscode.env.language) : "Unknown date",
      value: submission,
      description: submission.status,
      iconPath: submissionIcon(submission),
    }
    return submission === latest ? { ...item, detail: "Latest submission" } : item
  })
}

function submissionIcon(submission: PickableSubmission): vscode.ThemeIcon {
  switch (submission.kind) {
    case "paste":
      return new vscode.ThemeIcon("comment-discussion")
    case "backup":
      return new vscode.ThemeIcon("archive")
    case "submission":
      return submission.isPassed
        ? new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"))
        : new vscode.ThemeIcon("circle-large-outline")
  }
}

/**
 * Lets the user pick one of an exercise's earlier submissions and restores it
 * over the exercise's current state, optionally keeping that state on the backend first.
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
      const stored = userData.getExercise(exercise.id)
      if (stored.err) {
        return failure("Failed to resolve exercise id.", stored.val)
      }

      const { id } = exercise
      const submissionsResult = await dialog.progressNotification(
        `Fetching the submissions of ${exercise.exerciseSlug}…`,
        () => listOldSubmissions(actionContext, id),
      )
      if (submissionsResult.err) {
        return failure("Failed to fetch old submissions.", submissionsResult.val)
      }

      if (submissionsResult.val.length === 0) {
        dialog.notification(`${exercise.exerciseSlug} has no earlier submissions.`)
        return Ok.EMPTY
      }

      const submission = await dialog.selectItem(
        {
          title: `${TITLE} — ${exercise.exerciseSlug}`,
          placeHolder: "Pick a submission, help request or backup to restore",
        },
        ...submissionItems(submissionsResult.val),
      )
      if (!submission) {
        return Ok.EMPTY
      }

      const submitFirst = await confirmSubmitBeforeDestructiveAction(actionContext, exercise, {
        message: `Restore this submission of ${exercise.exerciseSlug}?`,
        replacement: "the submission",
        verb: "Restore",
        backend: id.kind,
      })
      if (submitFirst === undefined) {
        return Ok.EMPTY
      }
      if (submitFirst) {
        const trusted = checkTrustRetrying(actionContext, "tmc.downloadOldSubmission", exercise)
        if (trusted.err) {
          return trusted
        }
        const allowed = await checkAiUse(actionContext, exercise)
        if (allowed.err) {
          return allowed
        }
      }

      const restoreResult: Result<MoocOldSubmissionRestore, Error> =
        await dialog.progressNotification(
          submitFirst
            ? `${keepingVerb(id.kind)} ${exercise.exerciseSlug} and restoring the old submission…`
            : `Restoring the old submission of ${exercise.exerciseSlug}…`,
          () => restoreOldSubmission(actionContext, exercise, submission.target, submitFirst),
        )
      if (restoreResult.err) {
        return failure("Failed to download old submission.", restoreResult.val)
      }
      if (restoreResult.val === "nothing-to-download") {
        // Reachable only for an exercise type with no files at all, so never for a tmc
        // exercise. Nothing was changed, so this is ordinary news rather than a failure.
        dialog.notification("That submission has no files to download.")
      } else {
        await revertExerciseDocuments(exercise)
        dialog.statusMessage(`Restored the old submission of ${exercise.exerciseSlug}.`)
      }
      return Ok.EMPTY
    },
  )
}
