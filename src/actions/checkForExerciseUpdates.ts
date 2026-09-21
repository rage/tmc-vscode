import { flatten } from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { InitializationError } from "../errors"
import type { CourseIdentifier } from "../shared/shared"
import { ExerciseIdentifier, LocalCourseData, LocalCourseExercise } from "../shared/shared"
import { Logger } from "../utilities"
import type { ActionContext } from "./types"

interface Options {
  forceRefresh?: boolean
}

interface OutdatedExercise {
  courseId: CourseIdentifier
  exerciseName: string
  exerciseId: ExerciseIdentifier
}

/**
 * Checks all user's courses for exercise updates.
 */
export async function checkForExerciseUpdates(
  actionContext: ActionContext,
  options?: Options,
): Promise<Result<OutdatedExercise[], Error>> {
  const { authState, langs, userData } = actionContext
  if (!(langs.ok && userData.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  const forceRefresh = options?.forceRefresh ?? false
  Logger.info("Checking for exercise updates, forced update:", forceRefresh)

  // This runs on startup and on an interval, so a failure on one backend
  // (e.g. expired credentials) must not discard the other's results.
  const updateableExerciseIds = new Set<number | string>()
  const tmcCheckUpdatesResult = await langs.val.checkExerciseUpdates("tmc", { forceRefresh })
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
    const moocCheckUpdatesResult = await langs.val.checkExerciseUpdates("mooc", { forceRefresh })
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

  const outdatedExercisesByCourse = userData.val.getCourses().map<OutdatedExercise[]>((course) => {
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
  return Ok(outdatedExercises)
}
