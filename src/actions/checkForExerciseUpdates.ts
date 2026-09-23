import { flatten } from "lodash"

import type { CourseIdentifier } from "../shared/shared"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise } from "../shared/shared"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

interface Options {
  forceRefresh?: boolean
}

interface OutdatedExercise {
  courseId: CourseIdentifier
  exerciseName: string
  exerciseId: ExerciseIdentifier
}

/**
 * Lists the exercises in the user's courses that have updates. A backend whose check fails
 * is logged and skipped, so this has no failure of its own.
 */
export async function checkForExerciseUpdates(
  actionContext: ReadyActionContext,
  options?: Options,
): Promise<OutdatedExercise[]> {
  const { authState } = actionContext
  const { langs, userData } = actionContext.startup
  const forceRefresh = options?.forceRefresh ?? false
  Logger.info("Checking for exercise updates, forced update:", forceRefresh)

  // This runs on startup and on an interval, so a failure on one backend
  // (e.g. expired credentials) must not discard the other's results.
  const updateableExerciseIds = new Set<number | string>()
  const tmcCheckUpdatesResult = await langs.checkExerciseUpdates("tmc", { forceRefresh })
  if (tmcCheckUpdatesResult.ok) {
    for (const exerciseId of tmcCheckUpdatesResult.val) {
      updateableExerciseIds.add(ExerciseIdentifier.unwrap(exerciseId))
    }
  } else {
    Logger.warn("Skipping tmc.mooc.fi exercise update check; it failed:", tmcCheckUpdatesResult.val)
  }

  // Skipped entirely when courses.mooc.fi has no session, so a tmc-only user pays
  // no network cost on every background run.
  if (authState.mooc) {
    const moocCheckUpdatesResult = await langs.checkExerciseUpdates("mooc", { forceRefresh })
    if (moocCheckUpdatesResult.ok) {
      for (const exerciseId of moocCheckUpdatesResult.val) {
        updateableExerciseIds.add(ExerciseIdentifier.unwrap(exerciseId))
      }
    } else {
      Logger.warn(
        "Skipping courses.mooc.fi exercise update check; it failed:",
        moocCheckUpdatesResult.val,
      )
    }
  } else {
    Logger.debug("Skipping courses.mooc.fi exercise update check; not authenticated.")
  }

  const outdatedExercisesByCourse = userData.getCourses().map<OutdatedExercise[]>((course) => {
    const courseId = LocalCourseData.getCourseId(course)
    return LocalCourseData.getExercises(course)
      .filter((x) => updateableExerciseIds.has(x.data.id))
      .map((x) => ({
        courseId,
        exerciseId: LocalCourseExercise.getId(x),
        exerciseName: LocalCourseExercise.getSlug(x),
      }))
  })
  const outdatedExercises = flatten(outdatedExercisesByCourse)
  Logger.info(`Update check found ${outdatedExercises.length} outdated exercises`)
  return outdatedExercises
}
