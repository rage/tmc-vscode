import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { CourseIdentifier as CourseIdentifierNs } from "../shared/shared"
import { TmcPanel } from "./TmcPanel"

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
 */
class UpdateablesRegistry {
  private readonly _byCourse = new Map<string, ExerciseIdentifier[]>()

  /** The exercises last reported as updateable for `courseId`; empty if none were. */
  public get(courseId: CourseIdentifier): ExerciseIdentifier[] {
    return this._byCourse.get(CourseIdentifierNs.toString(courseId)) ?? []
  }

  public set(courseId: CourseIdentifier, exerciseIds: ExerciseIdentifier[]): void {
    this._byCourse.set(CourseIdentifierNs.toString(courseId), exerciseIds)
  }

  public clear(): void {
    this._byCourse.clear()
  }
}

export const updateablesRegistry = new UpdateablesRegistry()

/**
 * Records `exerciseIds` as `courseId`'s updateable exercises **and** posts them.
 *
 * The single writer: recording and posting separately would let the two drift, and a
 * reload would then restore a list the live UI never showed.
 */
export function postUpdateables(
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): void {
  updateablesRegistry.set(courseId, exerciseIds)
  TmcPanel.postMessage({
    type: "setUpdateables",
    target: { type: "CourseDetails" },
    courseId,
    exerciseIds,
  })
}
