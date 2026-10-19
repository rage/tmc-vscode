import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import { ExerciseIdentifier } from "../../shared/lib"
import { updateablesRegistry } from "./updateablesRegistry"

/** An exercise whose last update failed. */
export interface FailedUpdate {
  courseId: CourseIdentifier
  exerciseId: ExerciseIdentifier
  /** The name the student knows the exercise by. */
  exerciseName: string
  /** Why it failed, as a sentence for the student. */
  reason: string
}

/**
 * Remembers which exercises failed to update, for as long as that is still true: an exercise
 * updated since by any route, or one the last check found no update for, is dropped.
 */
class FailedUpdates {
  private readonly _failed = new Map<string, FailedUpdate>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires whenever {@link all} changes. */
  public readonly onDidChange = this._changed.event

  public constructor() {
    updateablesRegistry.onDidChange(() => this._dropNotUpdateable())
  }

  /** The failed updates, oldest first. */
  public all(): FailedUpdate[] {
    return [...this._failed.values()]
  }

  /** Replaces the record of each exercise in `failed` and drops each of `updated`. */
  public record(failed: readonly FailedUpdate[], updated: readonly ExerciseIdentifier[]): void {
    for (const id of updated) {
      this._failed.delete(ExerciseIdentifier.key(id))
    }
    for (const update of failed) {
      this._failed.set(ExerciseIdentifier.key(update.exerciseId), update)
    }
    this._changed.fire()
  }

  public clear(): void {
    this._failed.clear()
    this._changed.fire()
  }

  private _dropNotUpdateable(): void {
    let isChanged = false
    for (const [key, { courseId, exerciseId }] of this._failed) {
      const isUpdateable = updateablesRegistry
        .get(courseId)
        .some((id) => ExerciseIdentifier.key(id) === ExerciseIdentifier.key(exerciseId))
      if (!isUpdateable) {
        this._failed.delete(key)
        isChanged = true
      }
    }
    if (isChanged) {
      this._changed.fire()
    }
  }
}

export const failedUpdates = new FailedUpdates()
