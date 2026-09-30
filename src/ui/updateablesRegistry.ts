import * as vscode from "vscode"

import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { CourseIdentifier as CourseIdentifierNs } from "../shared/shared"

/**
 * Remembers which exercises have updates available, per course, for the Courses view.
 *
 * Finding them spawns several CLI processes per course, so the view cannot recompute
 * them on every render. In memory on purpose: `tmc.updateExercises silent` runs at
 * activation, so a fresh window refills this within seconds.
 */
class UpdateablesRegistry {
  private readonly _byCourse = new Map<string, ExerciseIdentifier[]>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link set} or {@link clear}. */
  public readonly onDidChange = this._changed.event

  /** The exercises last reported as updateable for `courseId`; empty if none were. */
  public get(courseId: CourseIdentifier): ExerciseIdentifier[] {
    return this._byCourse.get(CourseIdentifierNs.key(courseId)) ?? []
  }

  public set(courseId: CourseIdentifier, exerciseIds: ExerciseIdentifier[]): void {
    this._byCourse.set(CourseIdentifierNs.key(courseId), exerciseIds)
    this._changed.fire()
  }

  public clear(): void {
    this._byCourse.clear()
    this._changed.fire()
  }
}

export const updateablesRegistry = new UpdateablesRegistry()
