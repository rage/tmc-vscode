import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { NOTIFICATION_DELAY } from "../config/constants"
import { postUpdateables, withOptimisticList } from "../panels/exerciseLists"
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
  actionContext: ReadyActionContext,
  mode?: "silent" | "loud",
): Promise<void> {
  const { dialog, settings } = actionContext
  const { userData } = actionContext.startup
  const silent = mode === "silent"
  Logger.info("Checking for exercise updates")

  const updateablesResult = await actions.checkForExerciseUpdates(actionContext)
  if (updateablesResult.err) {
    Logger.warn("Failed to check for exercise updates.", updateablesResult.val)
    if (!silent) {
      dialog.reportError("Failed to check for exercise updates.", updateablesResult.val)
    }
    return
  }

  const now = Date.now()
  const exercisesToUpdate = updateablesResult.val.filter((x) => {
    const course = userData.getCourse(x.courseId)
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
    await withOptimisticList(
      () => postUpdateablesByCourse([]),
      async (): Promise<ExerciseIdentifier[] | undefined> => {
        const downloadResult = await actions.downloadOrUpdateExercises(
          actionContext,
          exercisesToUpdate.map((x) => x.exerciseId),
        )
        if (downloadResult.err) {
          dialog.reportError("Failed to update exercises.", downloadResult.val)
          return undefined
        }
        return downloadResult.val.failed
      },
      (failed) => postUpdateablesByCourse(failed ?? exercisesToUpdate.map((x) => x.exerciseId)),
    )
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
          const result = await userData.setNewExerciseNotifyAfter(courseId, notifyAfter)
          if (result.err) {
            dialog.reportError("Failed to postpone the reminder.", result.val)
            return
          }
        }
      },
    ],
  )
}
