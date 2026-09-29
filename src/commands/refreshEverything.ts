import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { CourseUpdateOptions } from "../actions"
import { checkForCourseUpdates, downloadNewExercisesForCourse } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { EXERCISE_CHECK_INTERVAL, NOTIFICATION_DELAY } from "../config/constants"
import { LocalCourseData } from "../shared/shared"
import { runSingleFlight } from "../utilities"
import { updateExercises } from "./updateExercises"

const REFRESH_FAILED = "Failed to check for course updates."

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
 * Offers to download the new exercises it finds, silent or not.
 *
 * @param courseId Refresh only that course's data; the exercise update check
 * always covers every course.
 * @param silent Logs a failed refresh, or one rejected as already running, instead
 * of notifying, and runs the exercise update check quietly. A refresh that fails runs
 * that check quietly either way: its own failure is the one report, and stale course
 * data cannot vouch for "All exercises are up to date."
 */
export async function refreshEverything(
  actionContext: ReadyActionContext,
  options: { silent: boolean } & CourseUpdateOptions,
): Promise<Result<void, Error>> {
  const { silent, courseId } = options
  return withOperation(
    actionContext.dialog,
    { failure: REFRESH_FAILED, silent, ...(courseId && { backend: courseId.kind }) },
    () => refresh(actionContext, options),
  )
}

/**
 * {@link refreshEverything} for the tree view's refresh button: loud, with each finished
 * course advancing a progress bar.
 */
export async function refreshCourses(actionContext: ReadyActionContext): Promise<void> {
  await withOperation(
    actionContext.dialog,
    { failure: REFRESH_FAILED, progress: "Fetching course updates..." },
    (report) =>
      refresh(actionContext, {
        silent: false,
        onProgress: (done, total) => report({ fraction: total === 0 ? 1 : done / total }),
      }),
  )
}

async function refresh(
  actionContext: ReadyActionContext,
  options: { silent: boolean } & CourseUpdateOptions,
): Promise<Result<void, Error>> {
  const { silent, courseId, onProgress } = options
  return runSingleFlight(
    {
      key: "refresh:all",
      // A wedged refresh releases the key by the time the next poll wants it.
      maxHoldMs: EXERCISE_CHECK_INTERVAL,
      busyMessage: "A refresh is already in progress.",
    },
    async () => {
      const refreshed = await checkForCourseUpdates(actionContext, { courseId, onProgress })
      if (refreshed.ok) {
        offerNewExercises(actionContext, refreshed.val.courses)
      }
      const failure = refreshed.err ? refreshed.val : refreshed.val.failure
      await updateExercises(actionContext, silent || failure ? "silent" : "loud")
      return failure ? Err(failure) : Ok.EMPTY
    },
  )
}

function offerNewExercises(actionContext: ReadyActionContext, courses: LocalCourseData[]): void {
  const { dialog } = actionContext
  const { userData } = actionContext.startup

  // `notifyAfter` throttles this toast only: gating the refresh on it too would
  // freeze course metadata and point totals for the whole delay, including the
  // refresh each submit asks for.
  const now = Date.now()
  for (const course of courses) {
    const newExercises = LocalCourseData.getNewExercises(course)
    if (newExercises.length === 0 || course.data.disabled || course.data.notifyAfter > now) {
      continue
    }
    const id = LocalCourseData.getCourseId(course)
    const courseName = LocalCourseData.getCourseName(course)
    const button = (failure: string, body: () => Promise<Result<void, Error>>) => (): void =>
      void withOperation(dialog, { failure, backend: course.kind }, body)
    void dialog.notification(
      `Found ${newExercises.length} new exercises for ${courseName}. Do you wish to download them now?`,
      [
        "Download",
        button("Failed to download new exercises for the course.", () =>
          downloadNewExercisesForCourse(actionContext, id),
        ),
      ],
      [
        "Remind me later",
        button("Failed to postpone the reminder.", () =>
          userData.setNewExerciseNotifyAfter(id, Date.now() + NOTIFICATION_DELAY),
        ),
      ],
      [
        "Don't remind about these exercises",
        button("Failed to dismiss the new exercises.", () => userData.clearFromNewExercises(id)),
      ],
    )
  }
}
