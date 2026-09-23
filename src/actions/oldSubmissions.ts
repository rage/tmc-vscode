import type { Result } from "ts-results"

import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type {
  ExerciseSlideSubmissionListItem,
  MoocOldSubmissionRestore,
} from "../shared/langsSchema"
import type { Enum, ExerciseIdentifier } from "../shared/shared"
import { assertUnreachable, makeMoocKind, makeTmcKind, match } from "../shared/shared"
import { runSingleFlight } from "../utilities"
import type { ReadyActionContext } from "./types"

/**
 * Everything the restore call needs, as one value: the exercise id and the
 * submission id are in different id spaces per backend (integers for TMC, uuid
 * strings for mooc) and pairing them here is what keeps a mismatch unbuildable.
 */
export type RestoreTarget = Enum<
  { exerciseId: number; submissionId: number },
  { exerciseId: string; submissionId: string }
>

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
 * Lists an exercise's earlier submissions, normalized for the picker across both backends.
 * The id spaces differ (TMC integer, mooc uuid string) and the status is derived
 * differently (TMC all_tests_passed vs mooc grading progress + score).
 */
export async function listOldSubmissions(
  actionContext: ReadyActionContext,
  id: ExerciseIdentifier,
): Promise<Result<PickableSubmission[], Error>> {
  const { langs } = actionContext.startup
  return match(
    id,
    (tmc): Promise<Result<PickableSubmission[], Error>> =>
      langs.getTmcOldSubmissions(tmc.tmcExerciseId).then((res) =>
        res.map((submissions) =>
          submissions.map<PickableSubmission>((submission) => ({
            target: makeTmcKind({ exerciseId: tmc.tmcExerciseId, submissionId: submission.id }),
            createdAt: submission.created_at,
            status: submission.all_tests_passed ? "Passed" : "Not passed",
          })),
        ),
      ),
    (mooc): Promise<Result<PickableSubmission[], Error>> =>
      langs.getMoocOldSubmissions(mooc.moocExerciseId).then((res) =>
        res.map((submissions) =>
          submissions.map<PickableSubmission>((submission) => ({
            target: makeMoocKind({ exerciseId: mooc.moocExerciseId, submissionId: submission.id }),
            createdAt: submission.created_at,
            status: moocSubmissionStatus(submission),
          })),
        ),
      ),
  )
}

/**
 * Restores one earlier submission over an exercise's current state, optionally submitting
 * that state first.
 *
 * Rejects as a `BottleneckError` while a submit, paste, reset or restore of the same
 * exercise is already in flight — all of them share one key because each overwrites or
 * reads the directory the others act on. The tmc CLI reports no outcome and only ever
 * restores, so its result is read as the mooc outcome the caller branches on.
 */
export async function restoreOldSubmission(
  actionContext: ReadyActionContext,
  exercisePath: string,
  target: RestoreTarget,
  submitFirst: boolean,
): Promise<Result<MoocOldSubmissionRestore, Error>> {
  const { langs } = actionContext.startup
  return runSingleFlight(
    {
      key: `submit:${exercisePath}`,
      maxHoldMs: CLI_PROCESS_TIMEOUT + 30_000,
      busyMessage: "A submission for this exercise is already in progress.",
    },
    () =>
      match(
        target,
        (tmc) =>
          langs
            .downloadTmcOldSubmission(tmc.exerciseId, exercisePath, tmc.submissionId, submitFirst)
            .then((res) => res.map(() => "restored" as const)),
        (mooc) =>
          langs.downloadMoocOldSubmission(
            mooc.exerciseId,
            exercisePath,
            mooc.submissionId,
            submitFirst,
          ),
      ),
  )
}
