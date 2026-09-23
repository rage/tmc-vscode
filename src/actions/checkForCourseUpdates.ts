import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { NOTIFICATION_DELAY } from "../config/constants"
import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { downloadNewExercisesForCourse } from "./downloadNewExercisesForCourse"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"
import { updateCourse } from "./updateCourse"

export interface CourseUpdateOptions {
  /** Refresh only this course instead of every added one. */
  courseId?: CourseIdentifier | undefined
  /** Called as each course finishes, for a progress indicator. */
  onProgress?: ((done: number, total: number) => void) | undefined
}

/**
 * Re-fetches each added course's data, then offers to download whatever new
 * exercises turned up.
 *
 * One course failing does not stop the rest; the returned `Err` names every
 * course that could not be refreshed. Nothing is reported here — the caller
 * decides whether a background failure is worth a notification.
 */
export async function checkForCourseUpdates(
  actionContext: ReadyActionContext,
  options: CourseUpdateOptions = {},
): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  const { courseId, onProgress } = options
  let courses: LocalCourseData[]
  if (courseId) {
    const courseResult = userData.getCourse(courseId)
    if (courseResult.err) {
      return courseResult
    }
    courses = [courseResult.val]
  } else {
    courses = userData.getCourses()
  }

  Logger.info(`Checking for course updates for courses`)
  let done = 0
  onProgress?.(done, courses.length)
  // Courses hold disjoint records and `UserData` serializes its own writes, so
  // these run together rather than one course's CLI round trips after another's.
  const refreshed = await Promise.all(
    courses.map(async (course) => {
      const id = LocalCourseData.getCourseId(course)
      const updateResult = await updateCourse(actionContext, id)
      onProgress?.(++done, courses.length)
      const reread = userData.getCourse(id)
      return {
        name: LocalCourseData.getCourseName(course),
        error: updateResult.err ? updateResult.val : reread.err ? reread.val : undefined,
        updated: reread.ok ? reread.val : undefined,
      }
    }),
  )
  // Once for the whole pass, not once per course: a course update can drop exercises the
  // backend no longer has, and only a rescan stops those still showing as open.
  await refreshLocalExercises(actionContext)
  const updatedCourses = refreshed
    .map((x) => x.updated)
    .filter((x): x is LocalCourseData => x !== undefined)
  const failures = refreshed.filter((x) => x.error !== undefined)
  for (const failure of failures) {
    Logger.warn(`Failed to update course ${failure.name}`, failure.error)
  }

  const handleDownload = async (course: LocalCourseData): Promise<void> => {
    const id = LocalCourseData.getCourseId(course)
    const downloadResult = await downloadNewExercisesForCourse(actionContext, id)
    if (downloadResult.err) {
      dialog.reportError(
        "Failed to download new exercises for the course.",
        downloadResult.val,
        course.kind,
      )
    }
  }

  // `notifyAfter` throttles this toast only: gating the refresh above on it too
  // would freeze course metadata and point totals for the whole delay, including
  // the refresh each submit asks for.
  const now = Date.now()
  for (const course of updatedCourses) {
    const newExercises = LocalCourseData.getNewExercises(course)
    if (newExercises.length > 0 && !course.data.disabled && course.data.notifyAfter <= now) {
      const id = LocalCourseData.getCourseId(course)
      const courseName = LocalCourseData.getCourseName(course)
      dialog.notification(
        `Found ${newExercises.length} new exercises for ${courseName}. Do you wish to download them now?`,
        ["Download", async (): Promise<void> => handleDownload(course)],
        [
          "Remind me later",
          async (): Promise<void> => {
            const result = await userData.setNewExerciseNotifyAfter(
              id,
              Date.now() + NOTIFICATION_DELAY,
            )
            if (result.err) {
              dialog.reportError("Failed to postpone the reminder.", result.val, course.kind)
            }
          },
        ],
        [
          "Don't remind about these exercises",
          async (): Promise<void> => {
            const result = await userData.clearFromNewExercises(id)
            if (result.err) {
              dialog.reportError("Failed to dismiss the new exercises.", result.val, course.kind)
            }
          },
        ],
      )
    }
  }

  if (failures.length > 0) {
    const names = failures.map((x) => x.name).join(", ")
    const firstMessage = failures[0]?.error?.message ?? "unknown error"
    return Err(new Error(`Failed to fetch updates for ${names}: ${firstMessage}`))
  }
  return Ok.EMPTY
}
