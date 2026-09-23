import type { Result } from "ts-results"

import type { CourseUpdateOptions } from "../actions/checkForCourseUpdates"
import { checkForCourseUpdates } from "../actions/checkForCourseUpdates"
import type { ReadyActionContext } from "../actions/types"
import { EXERCISE_CHECK_INTERVAL } from "../config/constants"
import { Logger, runSingleFlight } from "../utilities"
import { updateExercises } from "./updateExercises"

/**
 * The extension's one background refresh: course data first, then the exercise
 * update check.
 *
 * Activation, the maintenance poll, the tree view's refresh button and the tail
 * of each submit all want this, and two passes overlapping would interleave
 * writes to `UserData` and prompt twice about the same exercises. They share one
 * key, so a call made while another is running comes back as a
 * `BottleneckError` rather than queueing.
 *
 * @param courseId Refresh only that course's data; the exercise update check
 * always covers every course.
 * @param silent Downgrades both the "already refreshing" notice and a failed
 * course refresh from a notification to a log line, and runs the exercise
 * update check quietly.
 */
export async function refreshEverything(
  actionContext: ReadyActionContext,
  options: { silent: boolean } & CourseUpdateOptions,
): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { silent, courseId, onProgress } = options
  return runSingleFlight(
    {
      key: "refresh:all",
      // A wedged refresh releases the key by the time the next poll wants it.
      maxHoldMs: EXERCISE_CHECK_INTERVAL,
      busyMessage: "A refresh is already in progress.",
      onBusy: silent ? (): void => {} : (message): void => void dialog.notification(message),
    },
    async () => {
      const refreshed = await checkForCourseUpdates(actionContext, { courseId, onProgress })
      if (refreshed.err) {
        if (silent) {
          Logger.warn("Failed to check for course updates.", refreshed.val)
        } else {
          dialog.reportError("Failed to check for course updates.", refreshed.val, courseId?.kind)
        }
      }
      await updateExercises(actionContext, silent ? "silent" : "loud")
      return refreshed
    },
  )
}

/** Refreshes every added course, showing the exercise-check progress on the tree view's refresh button. */
export async function refreshCourses(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  await dialog.progressNotification("Fetching course updates...", async (progress) => {
    await refreshEverything(actionContext, {
      silent: false,
      onProgress: (done, total) => {
        progress.report({ fraction: total === 0 ? 1 : done / total })
      },
    })
  })
}
