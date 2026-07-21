import { uniq } from "lodash"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { NOTIFICATION_DELAY } from "../config/constants"
import { TmcPanel } from "../panels/TmcPanel"
import type { ExtensionToWebview } from "../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { Logger } from "../utilities"

export async function updateExercises(actionContext: ActionContext, silent: string): Promise<void> {
  const { dialog, settings, userData } = actionContext
  Logger.info("Checking for exercise updates")
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const updateablesResult = await actions.checkForExerciseUpdates(actionContext)
  if (updateablesResult.err) {
    Logger.warn("Failed to check for exercise updates.", updateablesResult.val)
    if (silent !== "silent") {
      dialog.errorNotification("Failed to check for exercise updates.")
    }
    return
  }

  const now = Date.now()
  const exercisesToUpdate = updateablesResult.val.filter((x) => {
    const course = userData.val.getCourse(x.courseId)
    return course.data.notifyAfter <= now && !course.data.disabled
  })

  if (exercisesToUpdate.length === 0) {
    if (silent !== "silent") {
      dialog.notification("All exercises are up to date.")
    }
    return
  }

  const downloadHandler = async (): Promise<void> => {
    // Broadcast per course so a CourseDetails panel only applies its own list;
    // identifiers are compared by canonical string since they're fresh objects.
    const coursesToUpdate = new Map(
      exercisesToUpdate.map((x) => [CourseIdentifier.toString(x.courseId), x.courseId]),
    )
    const exerciseIdsByCourse = (exerciseIds: ExerciseIdentifier[]): ExtensionToWebview[] => {
      const wanted = new Set(exerciseIds.map((x) => ExerciseIdentifier.unwrap(x)))
      return Array.from(coursesToUpdate.entries()).map<ExtensionToWebview>(([key, courseId]) => ({
        type: "setUpdateables",
        target: { type: "CourseDetails" },
        courseId,
        exerciseIds: exercisesToUpdate
          .filter(
            (x) =>
              CourseIdentifier.toString(x.courseId) === key &&
              wanted.has(ExerciseIdentifier.unwrap(x.exerciseId)),
          )
          .map((x) => x.exerciseId),
      }))
    }
    TmcPanel.postMessage(...exerciseIdsByCourse([]))
    const downloadResult = await actions.downloadOrUpdateExercises(
      actionContext,
      exercisesToUpdate.map((x) => x.exerciseId),
    )
    if (downloadResult.err) {
      dialog.errorNotification("Failed to update exercises.", downloadResult.val)
      return
    }

    TmcPanel.postMessage(...exerciseIdsByCourse(downloadResult.val.failed))
  }

  if (settings.getAutomaticallyUpdateExercises()) {
    return downloadHandler()
  }

  dialog.notification(
    `Found updates for ${exercisesToUpdate.length} exercises. Do you wish to download them?`,
    ["Download", downloadHandler],
    [
      "Remind me later",
      async (): Promise<void> => {
        const now2 = Date.now()
        const uniqueCourseIds = uniq(exercisesToUpdate.map((x) => x.courseId))
        uniqueCourseIds.forEach((x) => userData.val.setNotifyDate(x, now2 + NOTIFICATION_DELAY))
      },
    ],
  )
}
