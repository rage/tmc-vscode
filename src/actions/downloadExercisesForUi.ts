import { Result } from "ts-results"

import { withOptimisticList } from "../panels/exerciseLists"
import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Downloads exercises and rescans the disk, so the Courses view shows the result.
 *
 * `"update"` works through the course's updates and keeps the ones that failed listed;
 * `"download"` takes the downloaded exercises off the course's new-exercise list.
 */
export async function downloadExercisesForUi(
  actionContext: ReadyActionContext,
  mode: "download" | "update",
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup

  if (mode === "update") {
    const shownBeforeDownload = updateablesRegistry.get(courseId)
    await withOptimisticList(
      () => updateablesRegistry.set(courseId, []),
      async (): Promise<ExerciseIdentifier[]> => {
        const { failed } = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
        const refreshResult = await refreshLocalExercises(actionContext)
        if (refreshResult.err) {
          dialog.reportError("Failed to refresh local exercises.", refreshResult.val, courseId.kind)
        }
        return failed
      },
      (failed) => updateablesRegistry.set(courseId, failed ?? shownBeforeDownload),
    )
    return
  }

  const { successful } = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
  const refreshResult = Result.all(
    await userData.clearFromNewExercises(courseId, successful),
    await refreshLocalExercises(actionContext),
  )
  if (refreshResult.err) {
    dialog.reportError("Failed to refresh local exercises.", refreshResult.val, courseId.kind)
  }
}
