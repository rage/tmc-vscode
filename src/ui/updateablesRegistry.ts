import * as vscode from "vscode"

import type { BackendKind, CourseIdentifier } from "../../shared/lib"
import { CourseIdentifier as CourseIdentifierNs, ExerciseIdentifier } from "../../shared/lib"

/**
 * Remembers which exercises have updates available, per course, and which downloaded ones
 * their backend no longer has, for the Courses view.
 *
 * Finding them spawns several CLI processes per course, so the view cannot recompute
 * them on every render. In memory on purpose: `tmc.updateExercises silent` runs at
 * activation, so a fresh window refills this within seconds.
 */
class UpdateablesRegistry {
  private readonly _byCourse = new Map<string, ExerciseIdentifier[]>()
  private readonly _removedByBackend = new Map<BackendKind, Set<string>>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link setMany}, {@link setRemoved} or {@link clear}. */
  public readonly onDidChange = this._changed.event

  /** The exercises last reported as updateable for `courseId`; empty if none were. */
  public get(courseId: CourseIdentifier): ExerciseIdentifier[] {
    return this._byCourse.get(CourseIdentifierNs.key(courseId)) ?? []
  }

  /** Replaces the updateable exercises of each course listed, announced as one change. */
  public setMany(listsByCourse: Iterable<[CourseIdentifier, ExerciseIdentifier[]]>): void {
    for (const [courseId, exerciseIds] of listsByCourse) {
      this._byCourse.set(CourseIdentifierNs.key(courseId), exerciseIds)
    }
    this._changed.fire()
  }

  /** Whether `id` was last reported as gone from its backend. */
  public isRemoved(id: ExerciseIdentifier): boolean {
    return this._removedByBackend.get(id.kind)?.has(ExerciseIdentifier.key(id)) ?? false
  }

  /** Replaces the exercises `backend` was last found to no longer have. */
  public setRemoved(backend: BackendKind, exerciseIds: readonly ExerciseIdentifier[]): void {
    this._removedByBackend.set(
      backend,
      new Set(exerciseIds.map((id) => ExerciseIdentifier.key(id))),
    )
    this._changed.fire()
  }

  public clear(): void {
    this._byCourse.clear()
    this._removedByBackend.clear()
    this._changed.fire()
  }
}

export const updateablesRegistry = new UpdateablesRegistry()
