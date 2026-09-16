import { Result } from "ts-results"

import { postUpdateables, withOptimisticList } from "../panels/exerciseLists"
import { TmcPanel } from "../panels/TmcPanel"
import { updateablesRegistry } from "../panels/updateablesRegistry"
import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities/"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ActionContext } from "./types"

/**
 * Downloads exercises and pushes the resulting state back to the webview.
 *
 * `mode === "update"` drives the CourseDetails "update available" list; any other
 * mode drives the MyCourses "new exercises" list.
 */
export async function downloadExercisesForUi(
  actionContext: ActionContext,
  mode: string,
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): Promise<void> {
  const { dialog, userData } = actionContext
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  if (mode === "update") {
    const shownBeforeDownload = updateablesRegistry.get(courseId)
    await withOptimisticList(
      () => postUpdateables(courseId, []),
      async (): Promise<ExerciseIdentifier[] | undefined> => {
        const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
        if (downloadResult.err) {
          dialog.errorNotification("Failed to update exercises.", downloadResult.val)
          return undefined
        }
        const refreshResult = await refreshLocalExercises(actionContext)
        if (refreshResult.err) {
          dialog.errorNotification("Failed to refresh local exercises.", refreshResult.val)
        }
        return downloadResult.val.failed
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
    const course = userData.val.getCourse(courseId)
    if (course.err) {
      dialog.errorNotification("Failed to read the course.", course.val)
      return
    }
    postNewExercises(LocalCourseData.getNewExercises(course.val))
  }

  await withOptimisticList(
    () => postNewExercises([]),
    async () => {
      const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
      if (downloadResult.err) {
        dialog.errorNotification("Failed to download new exercises.", downloadResult.val)
        return
      }

      const refreshResult = Result.all(
        await userData.val.clearFromNewExercises(courseId, downloadResult.val.successful),
        await refreshLocalExercises(actionContext),
      )
      if (refreshResult.err) {
        dialog.errorNotification("Failed to refresh local exercises.", refreshResult.val)
      }
    },
    postRemainingNewExercises,
  )
  // Per-exercise status is already posted by `downloadOrUpdateExercises`, keyed by
  // exercise id on both backends. Re-posting a blanket "closed" for every input id
  // here would also mark the exercises whose download failed as closed.
}
