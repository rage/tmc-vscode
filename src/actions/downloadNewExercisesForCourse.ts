import { Ok, Result } from "ts-results"

import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import type { CourseIdentifier } from "../shared/shared"
import { CourseIdentifier as CourseIdentifierNs, LocalCourseData } from "../shared/shared"
import type { SingleFlightOptions } from "../utilities"
import { Logger, runSingleFlight } from "../utilities"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * The claim every download of a course's exercises holds, so the Courses view's Download and
 * Download New Exercises cannot run for one course at once.
 */
export function courseDownloadFlight(courseId: CourseIdentifier): SingleFlightOptions {
  return {
    key: `download:${courseId.kind}:${CourseIdentifierNs.toString(courseId)}`,
    // one CLI download per backend, then a rescan
    maxHoldMs: 3 * CLI_PROCESS_TIMEOUT,
    busyMessage: "This course's exercises are already downloading.",
  }
}

/**
 * Downloads a course's new exercises and takes the downloaded ones off its new-exercise list.
 *
 * An exercise that fails to download is warned about and stays on the list; the `Err` is for
 * a course that is not stored or a list or rescan that could not be updated, and a
 * `BottleneckError` while another download of the course runs.
 */
export async function downloadNewExercisesForCourse(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<Result<void, Error>> {
  return runSingleFlight(courseDownloadFlight(courseId), async () => {
    const { userData } = actionContext.startup
    const courseResult = userData.getCourse(courseId)
    if (courseResult.err) {
      return courseResult
    }
    Logger.info("Downloading new exercises for course")

    const newExercises = LocalCourseData.getNewExercises(courseResult.val)
    const { successful } = await downloadOrUpdateExercises(actionContext, newExercises, courseId)
    const refreshResult = Result.all(
      await userData.clearFromNewExercises(courseId, successful),
      await refreshLocalExercises(actionContext),
    )
    return refreshResult.err ? refreshResult : Ok.EMPTY
  })
}
