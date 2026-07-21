import type { Result } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import type { ExerciseSlideSubmissionListItem } from "../shared/langsSchema"
import { ExerciseIdentifier, match } from "../shared/shared"
import { dateToString, Logger, parseDate } from "../utilities"

/**
 * A submission normalized for the picker across both backends: the backend's own
 * submission id (integer for TMC, uuid string for mooc), a timestamp, and a
 * human-readable status shown next to the date.
 */
interface PickableSubmission {
  id: number | string
  createdAt: string
  status: string
}

/** Human-readable grading status for a mooc submission (score + progress). */
function moocSubmissionStatus(submission: ExerciseSlideSubmissionListItem): string {
  if (submission.grading_progress === null) {
    return "Not graded"
  }
  const score = submission.score_given !== null ? ` (score ${submission.score_given})` : ""
  switch (submission.grading_progress) {
    case "FullyGraded":
      return `${(submission.score_given ?? 0) > 0 ? "Passed" : "Not passed"}${score}`
    case "Failed":
      return `Failed${score}`
    case "PendingManual":
      return `Awaiting manual grading${score}`
    default:
      return `Pending${score}`
  }
}

/**
 * Looks for older submissions of the given exercise and lets user choose which one to download.
 * Uses resetExercise action before applying the contents of the actual submission.
 *
 * @param exerciseId exercise which older submission will be downloaded
 */
export async function downloadOldSubmission(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, langs, userData, workspaceManager } = actionContext
  Logger.info("Downloading old submission")
  if (!(workspaceManager.ok && userData.ok && langs.ok)) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const exercise = resource
    ? workspaceManager.val.getExerciseByPath(resource)
    : workspaceManager.val.activeExercise
  if (!exercise) {
    dialog.errorNotification("The active editor is not part of a course exercise.")
    return
  }

  // Look up by known backend rather than a name-only match, which could
  // resolve to the wrong backend if a tmc and mooc exercise share a slug.
  const exerciseId =
    exercise.backend === "mooc"
      ? userData.val.getMoocExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id
      : userData.val.getTmcExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id
  if (!exerciseId) {
    dialog.errorNotification("Failed to resolve exercise id.")
    return
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
            id: submission.id,
            createdAt: submission.created_at,
            status: submission.all_tests_passed ? "Passed" : "Not passed",
          })),
        ),
      ),
    (mooc): Promise<Result<PickableSubmission[], Error>> =>
      langs.val.getMoocOldSubmissions(mooc.moocExerciseId).then((res) =>
        res.map((submissions) =>
          submissions.map<PickableSubmission>((submission) => ({
            id: submission.id,
            createdAt: submission.created_at,
            status: moocSubmissionStatus(submission),
          })),
        ),
      ),
  )
  if (submissionsResult.err) {
    dialog.errorNotification("Failed to fetch old submissions.", submissionsResult.val)
    return
  }

  submissionsResult.val.sort(
    (a, b) => parseDate(a.createdAt).getTime() - parseDate(b.createdAt).getTime(),
  )
  if (submissionsResult.val.length === 0) {
    dialog.notification(`No previous submissions found for exercise ${exerciseId}`)
    return
  }

  const submission = await dialog.selectItem(
    {
      title: "Download Old Submission",
      placeHolder: exercise.exerciseSlug + ": Select a submission",
    },
    ...submissionsResult.val.map<[string, PickableSubmission]>((a) => [
      dateToString(parseDate(a.createdAt)) + "| " + a.status,
      a,
    ]),
  )
  if (!submission) {
    return
  }

  // Name the backend the submission would go to, so the mooc branch does not say
  // "TMC Server".
  const serverName = match(
    id,
    () => "TMC Server",
    () => "courses.mooc.fi",
  )
  const submitFirstSelection = await dialog.selectItem(
    {
      title: "Download Old Submission",
      placeHolder: `Do you want to save the current state of the exercise by submitting it to ${serverName}?`,
    },
    ["Submit to server", "submit"],
    ["Discard current state", "discard"],
  )
  if (submitFirstSelection === undefined) {
    Logger.debug("Answer for submitting first not provided, returning early.")
    return
  }

  let submitFirst = submitFirstSelection === "submit"
  // if we're submitting first, nothing will be lost anyway so it's probably okay to not annoy the user with a double confirm
  if (!submitFirst) {
    const confirm = await dialog.selectItem(
      { title: "Download Old Submission", placeHolder: "Are you sure?" },
      ["No, save the current exercise state", "submit"],
      ["Yes, discard current state", "discard"],
    )
    if (confirm === undefined) {
      return
    }
    submitFirst = confirm === "submit"
  }

  const editor = vscode.window.activeTextEditor
  const document = editor?.document.uri

  const oldDownloadResult = await match(
    id,
    (tmc) =>
      langs.val.downloadTmcOldSubmission(
        tmc.tmcExerciseId,
        exercise.uri.fsPath,
        submission.id as number,
        submitFirst,
      ),
    (mooc) =>
      langs.val.downloadMoocOldSubmission(
        mooc.moocExerciseId,
        exercise.uri.fsPath,
        String(submission.id),
        submitFirst,
      ),
  )
  if (oldDownloadResult.err) {
    dialog.errorNotification("Failed to download old submission.", oldDownloadResult.val)
  }

  if (editor && document) {
    await vscode.commands.executeCommand("workbench.action.files.revert", document)
  }
}
