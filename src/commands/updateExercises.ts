import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { NOTIFICATION_DELAY } from "../config/constants"
import { postUpdateables } from "../panels/updateablesRegistry"
import { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { Logger } from "../utilities"

/**
 * Downloads pending exercise updates, or offers to.
 *
 * `"silent"` is for runs the user did not ask for — activation, the background poll,
 * the refresh after a submit. It suppresses the "up to date" toast and the failure
 * notification but deliberately not the "Found updates" prompt, which together with
 * its "Remind me later" postponement is the only thing that reaches a user who has
 * turned automatic updates off.
 */
export async function updateExercises(
  actionContext: ActionContext,
  mode?: "silent" | "loud",
): Promise<void> {
  const { dialog, settings, userData } = actionContext
  const silent = mode === "silent"
  Logger.info("Checking for exercise updates")
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const updateablesResult = await actions.checkForExerciseUpdates(actionContext)
  if (updateablesResult.err) {
    Logger.warn("Failed to check for exercise updates.", updateablesResult.val)
    if (!silent) {
      dialog.errorNotification("Failed to check for exercise updates.")
    }
    return
  }

  const now = Date.now()
  const exercisesToUpdate = updateablesResult.val.filter((x) => {
    const course = userData.val.getCourse(x.courseId)
    return course.ok && course.val.data.notifyAfter <= now && !course.val.data.disabled
  })

  if (exercisesToUpdate.length === 0) {
    if (!silent) {
      dialog.notification("All exercises are up to date.")
    }
    return
  }

  // Keyed by canonical string because each `courseId` is a fresh object, so
  // anything comparing them by reference sees every exercise as its own course.
  const coursesToUpdate = new Map(
    exercisesToUpdate.map((x) => [CourseIdentifier.toString(x.courseId), x.courseId]),
  )

  const downloadHandler = async (): Promise<void> => {
    // Broadcast per course so a CourseDetails panel only applies its own list.
    const postUpdateablesByCourse = (exerciseIds: ExerciseIdentifier[]): void => {
      const wanted = new Set(exerciseIds.map((x) => ExerciseIdentifier.unwrap(x)))
      for (const [key, courseId] of coursesToUpdate) {
        postUpdateables(
          courseId,
          exercisesToUpdate
            .filter(
              (x) =>
                CourseIdentifier.toString(x.courseId) === key &&
                wanted.has(ExerciseIdentifier.unwrap(x.exerciseId)),
            )
            .map((x) => x.exerciseId),
        )
      }
    }
    postUpdateablesByCourse([])
    const downloadResult = await actions.downloadOrUpdateExercises(
      actionContext,
      exercisesToUpdate.map((x) => x.exerciseId),
    )
    if (downloadResult.err) {
      // The lists were emptied before starting; leaving them that way would tell
      // the student the exercises are up to date when nothing was downloaded.
      postUpdateablesByCourse(exercisesToUpdate.map((x) => x.exerciseId))
      dialog.errorNotification("Failed to update exercises.", downloadResult.val)
      return
    }

    postUpdateablesByCourse(downloadResult.val.failed)
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
        const notifyAfter = Date.now() + NOTIFICATION_DELAY
        for (const courseId of coursesToUpdate.values()) {
          const result = await userData.val.setNewExerciseNotifyAfter(courseId, notifyAfter)
          if (result.err) {
            dialog.errorNotification("Failed to postpone the reminder.", result.val)
            return
          }
        }
      },
    ],
  )
}
