import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { ExerciseSubmissionPanel } from "../../shared/lib"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { exerciseSubmissionPanel } from "../panels/routes"
import { exerciseStandingView } from "../ui/exerciseStanding"
import { submissionViews } from "../ui/submissionViews"
import { storedExerciseOf } from "./storedExercise"
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
  submissionViews.update({ panel, view, shouldReopen: false })
  return Ok(panel)
}
