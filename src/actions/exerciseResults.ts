import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { ExerciseSubmissionPanel, SubmissionView } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { exerciseSubmissionPanel } from "../panels/routes"
import { exerciseStandingView } from "../ui/exerciseStanding"
import { submissionViews } from "../ui/submissionViews"
import { storedExerciseOf } from "./storedExercise"
import { moocAccountIdOf, resumePendingGrading } from "./submitExercise"
import type { ReadyActionContext } from "./types"

/**
 * The results panel to show for `exercise`: its latest submission's, or else a new one on where
 * the exercise stands, kept in `submissionViews` with that view.
 *
 * Errs as {@link storedExerciseOf} does for an exercise its course no longer lists.
 */
export function exerciseResultsPanel(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Result<ExerciseSubmissionPanel, Error> {
  const latest = submissionViews.latestFor(exercise.id)
  if (latest) {
    return Ok(latest.panel)
  }
  const stored = storedExerciseOf(actionContext, exercise)
  if (stored.err) {
    return stored
  }
  const view = exerciseStandingView(actionContext.startup.userData, exercise.id)
  if (view === undefined) {
    return Err(new Error(`${exercise.exerciseSlug} is not in its course.`))
  }
  const panel = exerciseSubmissionPanel(exercise, stored.val)
  const { course, exercise: courseExercise } = stored.val
  const isGradingPending =
    exercise.backend === "mooc" &&
    resumePendingGrading(
      exercise,
      LocalCourseData.getCourseId(course),
      courseExercise.data.availablePoints,
      panel,
      moocAccountIdOf(actionContext.authState),
    )
  submissionViews.update({
    panel,
    view: isGradingPending ? { ...view, ...PENDING_GRADING_VIEW } : view,
    shouldReopen: false,
  })
  return Ok(panel)
}

/** What a results screen opened after a reload shows of a grading it went on waiting for. */
const PENDING_GRADING_VIEW: Partial<SubmissionView> = {
  phase: "timedOut",
  headline: "Your latest submission is still being graded",
  tone: "info",
  explanation: "VS Code was restarted while it was graded. Keep Waiting checks for its result.",
  canKeepWaiting: true,
}
