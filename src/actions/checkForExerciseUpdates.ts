import { flatten } from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { InitializationError } from "../errors"
import { assertUnreachable, CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
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
  const { langs, userData } = actionContext
  if (!(langs.ok && userData.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  const forceRefresh = options?.forceRefresh ?? false
  Logger.info("Checking for exercise updates, forced update:", forceRefresh)

  // This runs on startup and on an interval, so a failure on one backend
  // (e.g. expired credentials) must not discard the other's results.
  const tmcUpdateableExerciseIds = new Set<number>()
  const tmcCheckUpdatesResult = await langs.val.checkTmcExerciseUpdates({ forceRefresh })
  if (tmcCheckUpdatesResult.ok) {
    for (const exercise of tmcCheckUpdatesResult.val) {
      tmcUpdateableExerciseIds.add(exercise.id)
    }
  } else {
    Logger.warn("Skipping tmc.mooc.fi exercise update check; it failed:", tmcCheckUpdatesResult.val)
  }

  // Skipped entirely (via a cheap local check, no backend call) when not
  // authenticated, so a tmc-only user pays no network cost on every background run.
  const moocUpdateableExerciseIds = new Set<string>()
  const moocAuthenticated = await langs.val.isMoocAuthenticated()
  if (moocAuthenticated.ok && moocAuthenticated.val) {
    const moocCheckUpdatesResult = await langs.val.checkMoocExerciseUpdates({ forceRefresh })
    if (moocCheckUpdatesResult.ok) {
      for (const id of moocCheckUpdatesResult.val) {
        moocUpdateableExerciseIds.add(id)
      }
    } else {
      Logger.warn(
        "Skipping courses.mooc.fi exercise update check; it failed:",
        moocCheckUpdatesResult.val,
      )
    }
  } else {
    Logger.debug(
      "Skipping courses.mooc.fi exercise update check; not authenticated.",
      moocAuthenticated.err ? moocAuthenticated.val : undefined,
    )
  }

  const outdatedExercisesByCourse = userData.val.getCourses().map<OutdatedExercise[]>((course) => {
    switch (course.kind) {
      case "tmc": {
        const outdatedExercises = course.data.exercises.filter((x) =>
          tmcUpdateableExerciseIds.has(x.id),
        )
        return outdatedExercises.map((x) => ({
          courseId: CourseIdentifier.from(course.data.id),
          exerciseId: ExerciseIdentifier.from(x.id),
          exerciseName: x.name,
        }))
      }
      case "mooc": {
        const outdatedExercises = course.data.exercises.filter((x) =>
          moocUpdateableExerciseIds.has(x.id),
        )
        return outdatedExercises.map((x) => ({
          courseId: CourseIdentifier.from(course.data.id),
          exerciseId: ExerciseIdentifier.from(x.id),
          exerciseName: x.name,
        }))
      }
      default: {
        return assertUnreachable(course)
      }
    }
  })
  const outdatedExercises = flatten(outdatedExercisesByCourse)
  Logger.info(`Update check found ${outdatedExercises.length} outdated exercises`)
  return Ok(outdatedExercises)
}
