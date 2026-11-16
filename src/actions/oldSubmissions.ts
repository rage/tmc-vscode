import type { Result } from "ts-results"

import type {
  ExerciseSlideSubmissionListItem,
  MoocOldSubmissionRestore,
  SubmissionKind,
} from "../../shared/langsSchema"
import type { ExerciseIdentifier, SubmissionHistoryEntry } from "../../shared/lib"
import { assertUnreachable, makeMoocKind, makeTmcKind, match, unwrap } from "../../shared/lib"
import type { RestoreTarget } from "../api/langs"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { exerciseOperations } from "../ui/exerciseOperations"
import { formatTimestamp, parseDate } from "../utilities/dateDeadline"
import { saveExerciseDocuments } from "../window/exerciseDocuments"
import { fingerprintStudentFiles, recordKeptCopy } from "./keptCopies"
import type { ReadyActionContext } from "./types"

/** An earlier submission, help request or backup of an exercise, from either backend. */
export interface OldSubmission {
  target: RestoreTarget
  createdAt: string
  /** The outcome in a few words, without the score or the kind. */
  status: string
  /** In the exercise's own unit; absent while ungraded. */
  points?: { given: number; max: number } | undefined
  /** Passed all tests on tmc; graded to full points on mooc. */
  isPassed: boolean
  /** Only courses.mooc.fi keeps ungraded pastes and backups beside the submissions. */
  kind: SubmissionKind
  isShared: boolean
}

function moocStatus(submission: ExerciseSlideSubmissionListItem, maxPoints: number): string {
  if (submission.kind !== "submission") {
    return "Not graded"
  }
  const given = submission.score_given
  switch (submission.grading_progress) {
    case null:
      return "Not graded"
    case "FullyGraded":
      if (given === null || maxPoints <= 0) {
        return "Graded"
      }
      return given >= maxPoints ? "Passed" : given > 0 ? "Some tests failed" : "Tests failed"
    case "Failed":
      return "Grading failed"
    case "PendingManual":
      return "Awaiting manual grading"
    case "NotReady":
    case "Pending":
      return "Pending"
  }
  return assertUnreachable(submission.grading_progress)
}

function moocPoints(
  submission: ExerciseSlideSubmissionListItem,
  maxPoints: number,
): OldSubmission["points"] {
  if (submission.kind !== "submission" || submission.score_given === null) {
    return undefined
  }
  return { given: Math.round(submission.score_given * 100) / 100, max: maxPoints }
}

/**
 * Lists an exercise's earlier submissions, normalized across both backends. TMC reports whether
 * all tests passed and the points awarded, courses.mooc.fi the grading progress and score.
 */
export async function listOldSubmissions(
  actionContext: ReadyActionContext,
  id: ExerciseIdentifier,
): Promise<Result<OldSubmission[], Error>> {
  const { langs, userData } = actionContext.startup
  const stored = userData.getExercise(id)
  // The list does not carry the maximum, which the course's progress does.
  const maxPoints = stored.ok ? unwrap(stored.val.exercise).availablePoints : 0
  const listed = await langs.getOldSubmissions(id)
  return listed.map((old) =>
    match(
      old,
      ({ exerciseId, submissions }) =>
        submissions.map<OldSubmission>((submission) => ({
          target: makeTmcKind({ exerciseId, submissionId: submission.id }),
          createdAt: submission.created_at,
          status: submission.all_tests_passed
            ? "Passed"
            : submission.processed
              ? "Tests failed"
              : "Pending",
          points: submission.processed
            ? { given: tmcPointNames(submission.points).length, max: maxPoints }
            : undefined,
          isPassed: submission.all_tests_passed,
          kind: "submission",
          isShared: false,
        })),
      ({ exerciseId, submissions }) =>
        submissions.map<OldSubmission>((submission) => ({
          target: makeMoocKind({ exerciseId, submissionId: submission.id }),
          createdAt: submission.created_at,
          status: moocStatus(submission, maxPoints),
          points: moocPoints(submission, maxPoints),
          isPassed:
            submission.grading_progress === "FullyGraded" &&
            maxPoints > 0 &&
            (submission.score_given ?? 0) >= maxPoints,
          kind: submission.kind,
          isShared: submission.is_shared,
        })),
    ),
  )
}

/** The point names a TMC submission was awarded, which its API sends space-separated. */
function tmcPointNames(points: string | null): string[] {
  return (points ?? "").split(" ").filter((name) => name !== "")
}

/** Names `submission` among its exercise's History entries. */
export function oldSubmissionKey(submission: OldSubmission): string {
  return String(submission.target.data.submissionId)
}

/**
 * `submissions` as History lists them: graded submissions first, then help requests and
 * backups, each newest first, so the ones a student almost always wants are not buried under
 * backups. The newest graded submission is marked.
 *
 * @param locale The language the dates are written in.
 */
export function submissionHistory(
  submissions: readonly OldSubmission[],
  now: Date,
  locale: string | undefined,
): SubmissionHistoryEntry[] {
  const sorted = submissions
    .map((submission) => ({ submission, createdAt: parseDate(submission.createdAt) }))
    .toSorted((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
  const graded = sorted.filter(({ submission }) => submission.kind === "submission")
  const ungraded = sorted.filter(({ submission }) => submission.kind !== "submission")
  const newestGraded = graded[0]?.submission
  return [...graded, ...ungraded].map(({ submission, createdAt }) => ({
    key: oldSubmissionKey(submission),
    createdAt: submission.createdAt,
    dateLabel: createdAt ? formatTimestamp(createdAt, now, locale) : "Unknown date",
    kind: submission.kind,
    ...(submission.points ? { points: submission.points } : {}),
    status: submission.status,
    isPassed: submission.isPassed,
    isNewestGraded: submission === newestGraded,
    isShared: submission.isShared,
  }))
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
