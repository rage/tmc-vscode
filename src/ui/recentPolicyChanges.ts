import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import { CourseIdentifier as CourseIdentifierNs } from "../../shared/lib"

/**
 * The AI-policy changes a refresh found, per course, until the student dismisses the course
 * home's notice of them: the workspace follows a new policy silently, so it must leave a trace.
 * In memory, so a new window starts without one.
 */
class RecentPolicyChanges {
  private readonly _byCourse = new Map<string, string>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link add} or {@link dismiss}. */
  public readonly onDidChange = this._changed.event

  /** What changed, as a sentence; `undefined` when nothing did or it was dismissed. */
  public get(courseId: CourseIdentifier): string | undefined {
    return this._byCourse.get(CourseIdentifierNs.key(courseId))
  }

  /** @param sentence The new policy and what it does to AI assistance; replaces an earlier one. */
  public add(courseId: CourseIdentifier, sentence: string): void {
    this._byCourse.set(CourseIdentifierNs.key(courseId), sentence)
    this._changed.fire()
  }

  public dismiss(courseId: CourseIdentifier): void {
    if (this._byCourse.delete(CourseIdentifierNs.key(courseId))) {
      this._changed.fire()
    }
  }
}

export const recentPolicyChanges = new RecentPolicyChanges()
