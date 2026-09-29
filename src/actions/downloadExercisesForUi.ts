import { Result } from "ts-results"

import { postUpdateables, withOptimisticList } from "../panels/exerciseLists"
import { TmcPanel } from "../panels/TmcPanel"
import { updateablesRegistry } from "../panels/updateablesRegistry"
import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Downloads exercises and pushes the resulting state back to the webview.
 *
 * `"update"` drives the CourseDetails "update available" list, `"download"` the MyCourses
 * "new exercises" list.
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
      () => postUpdateables(courseId, []),
      async (): Promise<ExerciseIdentifier[]> => {
        const { failed } = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
        const refreshResult = await refreshLocalExercises(actionContext)
        if (refreshResult.err) {
          dialog.reportError("Failed to refresh local exercises.", refreshResult.val, courseId.kind)
        }
        return failed
      },
      (failed) => postUpdateables(courseId, failed ?? shownBeforeDownload),
    )
    return
  }

  const postNewExercises = (newExerciseIds: ExerciseIdentifier[]): void => {
    TmcPanel.postMessage({
      type: "setNewExercises",
      target: { type: "MyCourses" },
      courseId,
      exerciseIds: newExerciseIds,
    })
  }

  // Read the list back from storage rather than restoring the pre-download snapshot,
  // which re-announces the exercises the student just received.
  const postRemainingNewExercises = (): void => {
    const course = userData.getCourse(courseId)
    if (course.err) {
      dialog.reportError("Failed to read the course.", course.val, courseId.kind)
      return
    }
    postNewExercises(LocalCourseData.getNewExercises(course.val))
  }

  await withOptimisticList(
    () => postNewExercises([]),
    async () => {
      const { successful } = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
      const refreshResult = Result.all(
        await userData.clearFromNewExercises(courseId, successful),
        await refreshLocalExercises(actionContext),
      )
      if (refreshResult.err) {
        dialog.reportError("Failed to refresh local exercises.", refreshResult.val, courseId.kind)
      }
    },
    postRemainingNewExercises,
  )
  // Per-exercise status is already posted by `downloadOrUpdateExercises`, keyed by
  // exercise id on both backends. Re-posting a blanket "closed" for every input id
  // here would also mark the exercises whose download failed as closed.
}
