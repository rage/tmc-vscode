import type { Result } from "ts-results"

import type { RestoreTarget } from "../api/langs"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type {
  ExerciseSlideSubmissionListItem,
  MoocOldSubmissionRestore,
} from "../shared/langsSchema"
import {
  assertUnreachable,
  ExerciseIdentifier,
  makeMoocKind,
  makeTmcKind,
  match,
  unwrap,
} from "../shared/shared"
import { exerciseOperations } from "../ui/exerciseOperations"
import type { ReadyActionContext } from "./types"

/**
 * A submission normalized for the picker across both backends: what restoring it
 * takes, a timestamp, and a human-readable status shown next to the date.
 */
export interface PickableSubmission {
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
    // The backend judges passing per exercise, not per submission.
    case "FullyGraded":
      return `Graded${score}`
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
 * Lists an exercise's earlier submissions, normalized for the picker across both backends.
 * The status is derived differently: TMC reports whether all tests passed, courses.mooc.fi
 * the grading progress and score.
 */
export async function listOldSubmissions(
  actionContext: ReadyActionContext,
  id: ExerciseIdentifier,
): Promise<Result<PickableSubmission[], Error>> {
  const listed = await actionContext.startup.langs.getOldSubmissions(id)
  return listed.map((old) =>
    match(
      old,
      ({ exerciseId, submissions }) =>
        submissions.map<PickableSubmission>((submission) => ({
          target: makeTmcKind({ exerciseId, submissionId: submission.id }),
          createdAt: submission.created_at,
          status: submission.all_tests_passed ? "Passed" : "Not passed",
        })),
      ({ exerciseId, submissions }) =>
        submissions.map<PickableSubmission>((submission) => ({
          target: makeMoocKind({ exerciseId, submissionId: submission.id }),
          createdAt: submission.created_at,
          status: moocSubmissionStatus(submission),
        })),
    ),
  )
}

/**
 * Restores one earlier submission over an exercise's current state, optionally submitting
 * that state first.
 *
 * Rejects as a `BottleneckError` while a submit, paste, reset or restore of the same
 * exercise is already in flight.
 */
export async function restoreOldSubmission(
  actionContext: ReadyActionContext,
  exercisePath: string,
  target: RestoreTarget,
  submitFirst: boolean,
): Promise<Result<MoocOldSubmissionRestore, Error>> {
  return exerciseOperations.run(
    ExerciseIdentifier.from(unwrap(target).exerciseId),
    "restoring",
    CLI_PROCESS_TIMEOUT + 30_000,
    () => actionContext.startup.langs.restoreSubmission(target, exercisePath, submitFirst),
  )
}
