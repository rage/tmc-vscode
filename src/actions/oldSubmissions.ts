import type { Result } from "ts-results"

import type {
  ExerciseSlideSubmissionListItem,
  MoocOldSubmissionRestore,
  SubmissionKind,
} from "../../shared/langsSchema"
import type { ExerciseIdentifier } from "../../shared/lib"
import { assertUnreachable, makeMoocKind, makeTmcKind, match, unwrap } from "../../shared/lib"
import type { RestoreTarget } from "../api/langs"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { exerciseOperations } from "../ui/exerciseOperations"
import { saveExerciseDocuments } from "../window/exerciseDocuments"
import { fingerprintStudentFiles, recordKeptCopy } from "./keptCopies"
import type { ReadyActionContext } from "./types"

/**
 * A submission normalized for the picker across both backends: what restoring it
 * takes, a timestamp, and a human-readable status shown next to the date.
 */
export interface PickableSubmission {
  target: RestoreTarget
  createdAt: string
  status: string
  /** Passed all tests on tmc; graded to full points on mooc. */
  isPassed: boolean
  /** Only courses.mooc.fi keeps ungraded pastes and backups beside the submissions. */
  kind: SubmissionKind
}

/**
 * Human-readable status for a mooc submission (score + progress) or snapshot, and whether it
 * has a share link.
 *
 * @param maxPoints The exercise's points available; 0 when unknown.
 */
function moocSubmissionStatus(
  submission: ExerciseSlideSubmissionListItem,
  maxPoints: number,
): string {
  const status = moocGradingStatus(submission, maxPoints)
  return submission.is_shared ? `${status} · Shared` : status
}

function moocGradingStatus(submission: ExerciseSlideSubmissionListItem, maxPoints: number): string {
  switch (submission.kind) {
    case "paste":
      return "Sent for help, not graded"
    case "backup":
      return "Backup, not graded"
    case "submission":
      break
    default:
      return assertUnreachable(submission.kind)
  }
  const progress = submission.grading_progress
  if (progress === null) {
    return "Not graded"
  }
  const given = submission.score_given
  const score =
    given === null ? "" : maxPoints > 0 ? ` (${given}/${maxPoints} points)` : ` (score ${given})`
  switch (progress) {
    case "FullyGraded":
      if (given === null || maxPoints <= 0) {
        return `Graded${score}`
      }
      return given >= maxPoints
        ? `Passed${score}`
        : given > 0
          ? `Some tests failed${score}`
          : `Tests failed${score}`
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
  const { langs, userData } = actionContext.startup
  const stored = userData.getExercise(id)
  // The list does not carry the maximum, which the course's progress does.
  const maxPoints = stored.ok ? unwrap(stored.val.exercise).availablePoints : 0
  const listed = await langs.getOldSubmissions(id)
  return listed.map((old) =>
    match(
      old,
      ({ exerciseId, submissions }) =>
        submissions.map<PickableSubmission>((submission) => ({
          target: makeTmcKind({ exerciseId, submissionId: submission.id }),
          createdAt: submission.created_at,
          status: submission.all_tests_passed ? "Passed" : "Not passed",
          isPassed: submission.all_tests_passed,
          kind: "submission",
        })),
      ({ exerciseId, submissions }) =>
        submissions.map<PickableSubmission>((submission) => ({
          target: makeMoocKind({ exerciseId, submissionId: submission.id }),
          createdAt: submission.created_at,
          status: moocSubmissionStatus(submission, maxPoints),
          isPassed:
            submission.grading_progress === "FullyGraded" &&
            maxPoints > 0 &&
            (submission.score_given ?? 0) >= maxPoints,
          kind: submission.kind,
        })),
    ),
  )
}

/**
 * Restores one earlier submission over an exercise's current state, optionally keeping that
 * state on the backend first.
 *
 * Rejects as a `BottleneckError` while another operation on the exercise is in flight.
 */
export async function restoreOldSubmission(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
  target: RestoreTarget,
  submitFirst: boolean,
): Promise<Result<MoocOldSubmissionRestore, Error>> {
  const { langs, keptCopies } = actionContext.startup
  return exerciseOperations.run(exercise.id, "restoring", async () => {
    let keptFingerprint: string | undefined
    if (submitFirst) {
      const saved = await saveExerciseDocuments(exercise)
      if (saved.err) {
        return saved
      }
      keptFingerprint = await fingerprintStudentFiles(actionContext, exercise)
    }
    const restored = await langs.restoreSubmission(target, exercise.uri.fsPath, submitFirst)
    if (restored.ok && restored.val !== "nothing-to-download") {
      const { id } = exercise
      await keptCopies.record(id, id.kind === "mooc" ? "backup" : "submission", keptFingerprint)
      await recordKeptCopy(actionContext, exercise, "restore")
    }
    return restored
  })
}
