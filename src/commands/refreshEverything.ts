import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { CourseUpdateOptions } from "../actions"
import { checkForCourseUpdates, downloadNewExercisesForCourse } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure, withOperation } from "../api/withOperation"
import { EXERCISE_CHECK_INTERVAL, NOTIFICATION_DELAY } from "../config/constants"
import { LocalCourseData } from "../shared/shared"
import { COURSES_VIEW_ID } from "../ui/treeview/treeview"
import { runSingleFlight } from "../utilities"
import { updateExercises } from "./updateExercises"

const REFRESH_FAILED = "Failed to check for course updates."

/**
 * The extension's one background refresh: course data first, then the exercise
 * update check.
 *
 * Activation, the maintenance poll, the Courses view's refresh button and the tail
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
 * {@link refreshEverything} for the Courses view's refresh button: loud, with each finished
 * course advancing the view's progress bar.
 */
export async function refreshCourses(actionContext: ReadyActionContext): Promise<void> {
  await withOperation(
    actionContext.dialog,
    {
      failure: REFRESH_FAILED,
      progress: "Fetching course updates…",
      progressLocation: { viewId: COURSES_VIEW_ID },
    },
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
      const refreshFailure = refreshed.err ? refreshed.val : refreshed.val.failure
      await updateExercises(actionContext, silent || refreshFailure ? "silent" : "loud")
      return refreshFailure ? Err(refreshFailure) : Ok.EMPTY
    },
  )
}

/**
 * Offers, in one notification, the new exercises of every course whose reminder is due; each
 * button acts on all of those courses.
 */
function offerNewExercises(actionContext: ReadyActionContext, courses: LocalCourseData[]): void {
  const { dialog } = actionContext
  const { userData } = actionContext.startup

  // `notifyAfter` throttles this toast only: gating the refresh on it too would
  // freeze course metadata and point totals for the whole delay, including the
  // refresh each submit asks for.
  const now = Date.now()
  const offered = courses.filter(
    (course) =>
      LocalCourseData.getNewExercises(course).length > 0 &&
      !course.data.disabled &&
      course.data.notifyAfter <= now,
  )
  if (offered.length === 0) {
    return
  }

  const forEachCourse =
    (
      headline: (title: string) => string,
      step: (course: LocalCourseData) => Promise<Result<void, Error>>,
    ) =>
    (): void =>
      void withOperation(dialog, { failure: headline("a course") }, async () => {
        for (const course of offered) {
          const result = await step(course)
          if (result.err) {
            return failure(
              headline(LocalCourseData.getCourseTitle(course)),
              result.val,
              course.kind,
            )
          }
        }
        return Ok.EMPTY
      })

  void dialog.notification(
    newExercisesMessage(offered),
    [
      offered.length === 1 ? "Download" : "Download All",
      forEachCourse(
        (title) => `Failed to download the new exercises of ${title}.`,
        (course) =>
          downloadNewExercisesForCourse(actionContext, LocalCourseData.getCourseId(course)),
      ),
    ],
    [
      "Remind Me Later",
      forEachCourse(
        (title) => `Failed to postpone the reminder for ${title}.`,
        (course) =>
          userData.setNewExerciseNotifyAfter(
            LocalCourseData.getCourseId(course),
            Date.now() + NOTIFICATION_DELAY,
          ),
      ),
    ],
    [
      "Don't Remind Again",
      forEachCourse(
        (title) => `Failed to dismiss the new exercises of ${title}.`,
        (course) => userData.clearFromNewExercises(LocalCourseData.getCourseId(course)),
      ),
    ],
  )
}

function newExercisesMessage(courses: LocalCourseData[]): string {
  const counted = courses.map((course) => ({
    title: LocalCourseData.getCourseTitle(course),
    count: LocalCourseData.getNewExercises(course).length,
  }))
  const [only] = counted
  if (only && counted.length === 1) {
    const exercises = only.count === 1 ? "1 new exercise" : `${only.count} new exercises`
    return `${only.title} has ${exercises}. Download ${only.count === 1 ? "it" : "them"} now?`
  }
  const list = counted.map(({ title, count }) => `${title} (${count})`).join(", ")
  return `New exercises in ${counted.length} courses: ${list}. Download them now?`
}
