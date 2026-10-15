import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { CourseIdentifier, ExerciseIdentifier, LocalCourseData } from "../../shared/lib"
import type { CourseUpdateOptions } from "../actions"
import { checkForCourseUpdates, downloadNewExercisesForCourse } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { Warned } from "../api/withOperation"
import { failure, reportWarnings, withOperation } from "../api/withOperation"
import { NOTIFICATION_DELAY } from "../config/constants"
import { BottleneckError } from "../errors"
import { COURSES_VIEW_ID } from "../ui/treeview/treeview"
import { countOf, Logger } from "../utilities"
import { updateExercises } from "./updateExercises"

const REFRESH_FAILED = "Failed to check for course updates."

/** How a refresh runs; see {@link refreshEverything}. */
type RefreshOptions = {
  silent: boolean
  isQueuedWhenBusy?: boolean
  offersNewExercises?: boolean
  isPromptless?: boolean
} & CourseUpdateOptions

/**
 * The extension's one background refresh: course data first, then the exercise
 * update check.
 *
 * Activation, the maintenance poll, the Courses view's refresh button and the tail
 * of each submit all want this, and two passes overlapping would interleave
 * writes to `UserData` and prompt twice about the same exercises. A call made while
 * another is running comes back as a `BottleneckError`, unless it asks to be queued.
 *
 * @param courseId Refresh only that course's data; the exercise update check
 * always covers every course.
 * @param silent Logs a failed refresh, or one rejected as already running, instead
 * of notifying, and runs the exercise update check quietly. A refresh that fails runs
 * that check quietly either way: its own failure is the one report, and stale course
 * data cannot vouch for "All exercises are up to date." A refresh that is not silent
 * bypasses the CLI's cached update check.
 * @param isQueuedWhenBusy While another refresh runs, runs this one silently once that one
 * ends, and returns `Ok` at once. Calls queued meanwhile run together, as one refresh.
 * @param offersNewExercises `false` keeps the new exercises found for a later refresh to
 * offer, e.g. while a submission's result is what the student is reading.
 * @param isPromptless Offers neither new exercises nor exercise updates, for a window that
 * another one has just opened after offering them itself.
 */
export async function refreshEverything(
  actionContext: ReadyActionContext,
  options: RefreshOptions,
): Promise<Result<void, Error>> {
  return withOperation(
    actionContext.dialog,
    { failure: REFRESH_FAILED, silent: options.silent },
    () => refresh(actionContext, options),
  )
}

/**
 * {@link refreshEverything} for the Courses view's refresh button: loud, with each finished
 * course advancing the view's progress bar. One already running is waited for, not refused.
 */
export async function refreshCourses(actionContext: ReadyActionContext): Promise<void> {
  // A refresh queued behind the running one starts as it ends, so wait until none runs.
  for (let busy = running; busy; busy = running) {
    await busy
  }
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

/** The refresh in progress; settles, never rejecting, once it ends. */
let running: Promise<unknown> | undefined

/** The refresh to run once the one in progress ends; no `courseId` means every course. */
let queued: { courseId?: CourseIdentifier | undefined; offersNewExercises: boolean } | undefined

function refresh(
  actionContext: ReadyActionContext,
  options: RefreshOptions,
): Promise<Result<void, Error>> {
  const { courseId, isQueuedWhenBusy } = options
  const offersNewExercises = (options.offersNewExercises ?? true) && !options.isPromptless
  if (running) {
    if (isQueuedWhenBusy) {
      const isSameCourse =
        queued === undefined ||
        (queued.courseId !== undefined &&
          courseId !== undefined &&
          CourseIdentifier.equals(queued.courseId, courseId))
      queued = {
        courseId: isSameCourse ? courseId : undefined,
        offersNewExercises: offersNewExercises || (queued?.offersNewExercises ?? false),
      }
      return Promise.resolve(Ok.EMPTY)
    }
    Logger.warn("Rejected a refresh, one is already in flight")
    return Promise.resolve(Err(new BottleneckError("A refresh is already in progress.")))
  }
  const result = runRefresh(actionContext, { ...options, offersNewExercises })
  running = result.catch(() => undefined)
  return result.finally(() => {
    running = undefined
    const next = queued
    queued = undefined
    if (next) {
      void refreshEverything(actionContext, {
        silent: true,
        isQueuedWhenBusy: true,
        ...next,
      }).catch((e) => Logger.error("Queued refresh failed", e))
    }
  })
}

async function runRefresh(
  actionContext: ReadyActionContext,
  options: RefreshOptions,
): Promise<Result<void, Error>> {
  const { silent, courseId, onProgress, offersNewExercises, isPromptless } = options
  const refreshed = await checkForCourseUpdates(actionContext, { courseId, onProgress })
  if (refreshed.ok) {
    reportWarnings(actionContext.dialog, refreshed.val.warnings)
    if (offersNewExercises) {
      offerNewExercises(actionContext, refreshed.val.courses)
    }
  }
  const refreshFailure = refreshed.err ? refreshed.val : refreshed.val.failure
  await updateExercises(
    actionContext,
    isPromptless ? "promptless" : silent || refreshFailure ? "silent" : "loud",
  )
  return refreshFailure ? Err(refreshFailure) : Ok.EMPTY
}

/**
 * Offers, in one notification, the new exercises of every course whose reminder is due; each
 * button acts on all of those courses, one failing course not stopping the rest.
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
      hasUnofferedNewExercises(course) &&
      !LocalCourseData.isDisabled(course) &&
      course.data.notifyAfter <= now,
  )
  if (offered.length === 0) {
    return
  }
  for (const course of offered) {
    void userData.setNewExercisesOffered(LocalCourseData.getCourseId(course)).then((recorded) => {
      if (recorded.err) {
        Logger.error("Failed to record the offered new exercises", recorded.val)
      }
    })
  }

  const forEachCourse =
    (
      headline: (title: string) => string,
      step: (course: LocalCourseData) => Promise<Result<Warned | void, Error>>,
    ) =>
    (): void =>
      void withOperation(dialog, { failure: headline("a course") }, async () => {
        const failed: [title: string, error: Error][] = []
        for (const course of offered) {
          const result = await step(course)
          if (result.err) {
            failed.push([LocalCourseData.getCourseTitle(course), result.val])
          } else if (result.val) {
            reportWarnings(dialog, result.val.warnings)
          }
        }
        const [first, ...others] = failed
        if (!first) {
          return Ok.EMPTY
        }
        for (const [title, error] of others) {
          Logger.error(headline(title), error)
        }
        return failure(headline(failed.map(([title]) => title).join(", ")), first[1])
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
          userData.postponeNewExercises(
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

/** Whether the course has new exercises no notification has offered yet. */
function hasUnofferedNewExercises(course: LocalCourseData): boolean {
  const offered = new Set((course.data.offeredNewExercises ?? []).map(String))
  return LocalCourseData.getNewExercises(course).some(
    (id) => !offered.has(ExerciseIdentifier.toString(id)),
  )
}

function newExercisesMessage(courses: LocalCourseData[]): string {
  const counted = courses.map((course) => ({
    title: LocalCourseData.getCourseTitle(course),
    count: LocalCourseData.getNewExercises(course).length,
  }))
  const [only] = counted
  if (only && counted.length === 1) {
    return `${only.title} has ${countOf(only.count, "new exercise")}. Download ${only.count === 1 ? "it" : "them"} now?`
  }
  const list = counted.map(({ title, count }) => `${title} (${count})`).join(", ")
  return `New exercises in ${counted.length} courses: ${list}. Download them now?`
}
