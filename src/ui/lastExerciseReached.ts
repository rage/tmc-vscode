import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import { CourseIdentifier as CourseIdentifierNs } from "../../shared/lib"

/**
 * The courses Open Next Exercise went past the last exercise of, until the student opens one of
 * their exercises or dismisses the course home's notice. In memory, so a new window starts
 * without any.
 */
class LastExerciseReached {
  private readonly _courseKeys = new Set<string>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link add} or {@link clear} changes anything. */
  public readonly onDidChange = this._changed.event

  public has(courseId: CourseIdentifier): boolean {
    return this._courseKeys.has(CourseIdentifierNs.key(courseId))
  }

  public add(courseId: CourseIdentifier): void {
    const key = CourseIdentifierNs.key(courseId)
    if (!this._courseKeys.has(key)) {
      this._courseKeys.add(key)
      this._changed.fire()
    }
  }

  public clear(courseId: CourseIdentifier): void {
    if (this._courseKeys.delete(CourseIdentifierNs.key(courseId))) {
      this._changed.fire()
    }
  }
}

export const lastExerciseReached = new LastExerciseReached()
