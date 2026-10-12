import type { BackendKind, CourseIdentifier } from "../shared/shared"
import {
  backendName,
  ExerciseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
} from "../shared/shared"
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

/** What {@link checkForExerciseUpdates} found. */
export interface ExerciseUpdateCheck {
  outdated: OutdatedExercise[]
  /**
   * The backends holding the user's courses whose check failed. `outdated` says nothing
   * about their exercises.
   */
  failures: { backend: BackendKind; error: Error }[]
}

/**
 * Lists the exercises in the user's courses that have updates. Only backends holding some of
 * the user's courses are asked, and one whose check fails is named in `failures` rather than
 * failing the whole check.
 */
export async function checkForExerciseUpdates(
  actionContext: ReadyActionContext,
  options?: Options,
): Promise<ExerciseUpdateCheck> {
  const { langs, userData } = actionContext.startup
  const forceRefresh = options?.forceRefresh ?? false
  Logger.info("Checking for exercise updates, forced update:", forceRefresh)

  const courses = userData.getCourses()
  const backends = [...new Set(courses.map((course) => course.kind))]
  const checks = await Promise.all(
    backends.map(async (backend) => ({
      backend,
      result: await langs.checkExerciseUpdates(backend, { forceRefresh }),
    })),
  )
  const updateable = new Set<string>()
  const failures: ExerciseUpdateCheck["failures"] = []
  for (const { backend, result } of checks) {
    if (result.ok) {
      result.val.forEach((id) => updateable.add(ExerciseIdentifier.key(id)))
    } else {
      Logger.warn(
        `Skipping the ${backendName(backend)} exercise update check; it failed:`,
        result.val,
      )
      failures.push({ backend, error: result.val })
    }
  }

  const outdated = courses.flatMap((course) => {
    const courseId = LocalCourseData.getCourseId(course)
    return LocalCourseData.getExercises(course)
      .filter((x) => updateable.has(ExerciseIdentifier.key(LocalCourseExercise.getId(x))))
      .map((x) => ({
        courseId,
        exerciseId: LocalCourseExercise.getId(x),
        exerciseName: LocalCourseExercise.getSlug(x),
      }))
  })
  Logger.info(`Update check found ${outdated.length} outdated exercises`)
  return { outdated, failures }
}
