import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type {
  ExerciseSlideSubmissionListItem,
  MoocOldSubmissionRestore,
} from "../shared/langsSchema"
import type { Enum } from "../shared/shared"
import {
  assertUnreachable,
  backendName,
  ExerciseIdentifier,
  makeMoocKind,
  makeTmcKind,
  match,
} from "../shared/shared"
import { dateToString, Logger, parseDate, runSingleFlight } from "../utilities"
import { confirmSubmitBeforeDestructiveAction } from "./confirmSubmitBeforeDestructiveAction"
import { failure, runForExercise } from "./runForExercise"

const TITLE = "Download Old Submission"

/**
 * Everything the restore call needs, as one value: the exercise id and the
 * submission id are in different id spaces per backend (integers for TMC, uuid
 * strings for mooc) and pairing them here is what keeps a mismatch unbuildable.
 */
type RestoreTarget = Enum<
  { exerciseId: number; submissionId: number },
  { exerciseId: string; submissionId: string }
>

/**
 * A submission normalized for the picker across both backends: what restoring it
 * takes, a timestamp, and a human-readable status shown next to the date.
 */
interface PickableSubmission {
  target: RestoreTarget
  createdAt: string
  status: string
}

/** Human-readable grading status for a mooc submission (score + progress). */
function moocSubmissionStatus(submission: ExerciseSlideSubmissionListItem): string {
  const progress = submission.grading_progress
  if (progress === null) {
    return "Not graded"
  }
  const score = submission.score_given !== null ? ` (score ${submission.score_given})` : ""
  switch (progress) {
    case "FullyGraded":
      return `${(submission.score_given ?? 0) > 0 ? "Passed" : "Not passed"}${score}`
    case "Failed":
      return `Failed${score}`
    case "PendingManual":
      return `Awaiting manual grading${score}`
    case "NotReady":
    case "Pending":
      return `Pending${score}`
  }
  return assertUnreachable(progress)
}

/**
 * Lets the user pick one of an exercise's earlier submissions and restores it
 * over the exercise's current state, optionally submitting that state first.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 */
export async function downloadOldSubmission(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, langs, userData } = actionContext
  if (!(langs.ok && userData.ok)) {
    Logger.error("Extension was not initialized properly")
    return
  }

  await runForExercise(
    actionContext,
    resource,
    "Downloading the old submission",
    async (exercise) => {
      // Look up by known backend rather than a name-only match, which could
      // resolve to the wrong backend if a tmc and mooc exercise share a slug.
      const exerciseId =
        exercise.backend === "mooc"
          ? userData.val.getMoocExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id
          : userData.val.getTmcExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id
      if (!exerciseId) {
        return failure("Failed to resolve exercise id.")
      }

      const id = ExerciseIdentifier.from(exerciseId)
      Logger.debug("Fetching old submissions")
      // Normalize both backends' submission shapes into a common pickable list; the
      // id spaces differ (TMC integer, mooc uuid string) and the status is derived
      // differently (TMC all_tests_passed vs mooc grading progress + score).
      const submissionsResult = await match(
        id,
        (tmc): Promise<Result<PickableSubmission[], Error>> =>
          langs.val.getTmcOldSubmissions(tmc.tmcExerciseId).then((res) =>
            res.map((submissions) =>
              submissions.map<PickableSubmission>((submission) => ({
                target: makeTmcKind({
                  exerciseId: tmc.tmcExerciseId,
                  submissionId: submission.id,
                }),
                createdAt: submission.created_at,
                status: submission.all_tests_passed ? "Passed" : "Not passed",
              })),
            ),
          ),
        (mooc): Promise<Result<PickableSubmission[], Error>> =>
          langs.val.getMoocOldSubmissions(mooc.moocExerciseId).then((res) =>
            res.map((submissions) =>
              submissions.map<PickableSubmission>((submission) => ({
                target: makeMoocKind({
                  exerciseId: mooc.moocExerciseId,
                  submissionId: submission.id,
                }),
                createdAt: submission.created_at,
                status: moocSubmissionStatus(submission),
              })),
            ),
          ),
      )
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

      // Key shared with the submit and paste actions: restoring overwrites the directory a
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

          // The tmc CLI reports no outcome, and only ever restores, so both backends are read
          // as the mooc outcome the UI below branches on.
          const restoreResult: Result<MoocOldSubmissionRestore, Error> = await match(
            submission.target,
            (tmc) =>
              langs.val
                .downloadTmcOldSubmission(
                  tmc.exerciseId,
                  exercise.uri.fsPath,
                  tmc.submissionId,
                  submitFirst,
                )
                .then((res) => res.map(() => "restored" as const)),
            (mooc) =>
              langs.val.downloadMoocOldSubmission(
                mooc.exerciseId,
                exercise.uri.fsPath,
                mooc.submissionId,
                submitFirst,
              ),
          )
          if (editor && document) {
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
    },
  )
}
