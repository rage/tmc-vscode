import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { RestoreOutcome } from "../../shared/lib"
import type { OldSubmission } from "../actions"
import { checkAiUse, restoreOldSubmission } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { confirmSubmitBeforeDestructiveAction } from "../window/confirmSubmitBeforeDestructiveAction"
import { revertExerciseDocuments } from "../window/exerciseDocuments"

/**
 * Restores `submission` over the exercise once the student confirms it in a modal, which also
 * asks whether to keep the current code on the backend first.
 *
 * Reports nothing itself: the History that asked shows the outcome and any failure.
 *
 * @param onConfirmed Called once the student has confirmed, as the restore begins.
 */
export async function restoreSubmission(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
  submission: OldSubmission,
  onConfirmed: () => void = () => {},
): Promise<Result<RestoreOutcome, Error>> {
  const { id } = exercise
  const submitFirst = await confirmSubmitBeforeDestructiveAction(actionContext, exercise, {
    message: `Restore this submission of ${exercise.exerciseSlug}?`,
    replacement: "the submission",
    verb: "Restore",
    backend: id.kind,
  })
  if (submitFirst === undefined) {
    return Ok("cancelled")
  }
  onConfirmed()
  if (submitFirst) {
    // The student presses Restore again once trusted, so nothing is held back to retry.
    const untrusted = actionContext.startup.trustGate.refusal()
    if (untrusted) {
      return Err(untrusted)
    }
    const allowed = await checkAiUse(actionContext, exercise)
    if (allowed.err) {
      return allowed
    }
  }
  const restored = await restoreOldSubmission(
    actionContext,
    exercise,
    submission.target,
    submitFirst,
  )
  if (restored.err) {
    return restored
  }
  if (restored.val === "nothing-to-download") {
    // Only an exercise type with no files at all has none, so never a tmc exercise.
    return Ok("nothingToDownload")
  }
  await revertExerciseDocuments(exercise)
  return Ok("restored")
}
