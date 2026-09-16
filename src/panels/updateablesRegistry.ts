import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { CourseIdentifier as CourseIdentifierNs } from "../shared/shared"

/**
 * Remembers which exercises have updates available, per course.
 *
 * `setUpdateables` is only ever posted as a delta, by a producer that spawns several CLI
 * processes and walks every course, so a CourseDetails panel opened (or reloaded) later
 * cannot ask for it and cannot afford to recompute it. This holds the last value each
 * panel was told, so `requestCourseDetailsData` can answer from it.
 *
 * In memory on purpose: `tmc.updateExercises silent` runs at activation, so a fresh
 * window refills this within seconds.
 *
 * Deliberately free of any panel import: the panel layer reads this registry, so
 * reaching back into it from here would put the two in an import cycle.
 */
class UpdateablesRegistry {
  private readonly _byCourse = new Map<string, ExerciseIdentifier[]>()

  /** The exercises last reported as updateable for `courseId`; empty if none were. */
  public get(courseId: CourseIdentifier): ExerciseIdentifier[] {
    return this._byCourse.get(CourseIdentifierNs.toString(courseId)) ?? []
  }

  /** Write through `postUpdateables` in `./exerciseLists`, or this and the live UI drift. */
  public set(courseId: CourseIdentifier, exerciseIds: ExerciseIdentifier[]): void {
    this._byCourse.set(CourseIdentifierNs.toString(courseId), exerciseIds)
  }

  public clear(): void {
    this._byCourse.clear()
  }
}

export const updateablesRegistry = new UpdateablesRegistry()
