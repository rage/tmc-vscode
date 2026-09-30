import * as vscode from "vscode"

import type { CourseIdentifier, ExerciseIdentifier, ExerciseStatus } from "../shared/shared"
import {
  CourseIdentifier as CourseIdentifierNs,
  ExerciseIdentifier as ExerciseIdentifierNs,
} from "../shared/shared"

/** The statuses the workspace cannot derive from what is on disk. */
const IN_FLIGHT_STATUSES: ReadonlySet<ExerciseStatus> = new Set(["downloading", "downloadFailed"])

/**
 * Remembers which exercises are downloading, or failed to, per course.
 *
 * Those statuses exist only as they are posted, so a CourseDetails panel opened (or
 * reloaded) mid-download would otherwise show the exercise as not downloaded and offer
 * to download it again. Any other status posted for an exercise drops its entry.
 *
 * Deliberately free of any panel import, like `updateablesRegistry`.
 */
class ExerciseStatusRegistry {
  private readonly _byCourse = new Map<string, Map<string, [ExerciseIdentifier, ExerciseStatus]>>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link record} or {@link clear}. */
  public readonly onDidChange = this._changed.event

  /** The in-flight statuses last posted for `courseId`'s exercises. */
  public get(courseId: CourseIdentifier): [ExerciseIdentifier, ExerciseStatus][] {
    return Array.from(this._byCourse.get(courseKey(courseId))?.values() ?? [])
  }

  /** Write through `postExerciseStatuses` in `./exerciseLists`, or this and the live UI drift. */
  public record(
    courseId: CourseIdentifier,
    statuses: [ExerciseIdentifier, ExerciseStatus][],
  ): void {
    const key = courseKey(courseId)
    const course =
      this._byCourse.get(key) ?? new Map<string, [ExerciseIdentifier, ExerciseStatus]>()
    for (const [exerciseId, status] of statuses) {
      const exerciseKey = `${exerciseId.kind}:${ExerciseIdentifierNs.toString(exerciseId)}`
      if (IN_FLIGHT_STATUSES.has(status)) {
        course.set(exerciseKey, [exerciseId, status])
      } else {
        course.delete(exerciseKey)
      }
    }
    if (course.size > 0) {
      this._byCourse.set(key, course)
    } else {
      this._byCourse.delete(key)
    }
    this._changed.fire()
  }

  public clear(): void {
    this._byCourse.clear()
    this._changed.fire()
  }
}

function courseKey(courseId: CourseIdentifier): string {
  return `${courseId.kind}:${CourseIdentifierNs.toString(courseId)}`
}

export const exerciseStatusRegistry = new ExerciseStatusRegistry()
