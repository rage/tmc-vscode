import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import { CourseIdentifier as CourseIdentifierNs } from "../../shared/lib"

/**
 * The exercises automatic updates replaced, per course, until the student dismisses the course
 * home's notice of them: a change to their files they did not ask for must leave a trace. In
 * memory, so a new window starts without one.
 */
class RecentUpdates {
  private readonly _byCourse = new Map<string, string[]>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link add} or {@link dismiss}. */
  public readonly onDidChange = this._changed.event

  /** The names of the exercises updated, oldest update first. */
  public get(courseId: CourseIdentifier): string[] {
    return this._byCourse.get(CourseIdentifierNs.key(courseId)) ?? []
  }

  public add(courseId: CourseIdentifier, exerciseNames: readonly string[]): void {
    const key = CourseIdentifierNs.key(courseId)
    const names = new Set([...(this._byCourse.get(key) ?? []), ...exerciseNames])
    this._byCourse.set(key, [...names])
    this._changed.fire()
  }

  public dismiss(courseId: CourseIdentifier): void {
    if (this._byCourse.delete(CourseIdentifierNs.key(courseId))) {
      this._changed.fire()
    }
  }
}

export const recentUpdates = new RecentUpdates()
