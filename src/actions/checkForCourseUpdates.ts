import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"
import { updateCourse } from "./updateCourse"

export interface CourseUpdateOptions {
  /** Refresh only this course instead of every added one. */
  courseId?: CourseIdentifier | undefined
  /** Called as each course finishes, for a progress indicator. */
  onProgress?: ((done: number, total: number) => void) | undefined
}

/** What a pass of {@link checkForCourseUpdates} left behind. */
export interface CourseUpdates {
  /** Every course read back after the pass, whether or not its own refresh succeeded. */
  courses: LocalCourseData[]
  /** Names every course that could not be refreshed; the others were. */
  failure: Error | undefined
}

/**
 * Re-fetches each added course's data.
 *
 * One course failing does not stop the rest, so that is reported in `failure` rather than as
 * an `Err`, which is only for a `courseId` that is not stored.
 */
export async function checkForCourseUpdates(
  actionContext: ReadyActionContext,
  options: CourseUpdateOptions = {},
): Promise<Result<CourseUpdates, Error>> {
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
  for (const failed of failures) {
    Logger.warn(`Failed to update course ${failed.name}`, failed.error)
  }

  const names = failures.map((x) => x.name).join(", ")
  const firstMessage = failures[0]?.error?.message ?? "unknown error"
  return Ok({
    courses: updatedCourses,
    failure:
      failures.length > 0
        ? new Error(`Failed to fetch updates for ${names}: ${firstMessage}`)
        : undefined,
  })
}
