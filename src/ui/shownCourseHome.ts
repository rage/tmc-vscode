import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import { CourseIdentifier as CourseIdentifierNs } from "../../shared/lib"
import type { FailureSink } from "../api/withOperation"

/** A failure for the course home of `courseId`; see {@link ShownCourseHome.failureSink}. */
export interface CourseHomeFailure {
  courseId: CourseIdentifier
  headline: string
  error: Error | undefined
  tone: "error" | "warning"
}

/**
 * The course whose course home is on screen, if any, so news about that course goes into the
 * page instead of a notification. The main panel keeps it current.
 */
class ShownCourseHome {
  private _courseId: CourseIdentifier | undefined
  private readonly _changed = new vscode.EventEmitter<void>()
  private readonly _failed = new vscode.EventEmitter<CourseHomeFailure>()
  private readonly _failuresCleared = new vscode.EventEmitter<{
    courseId: CourseIdentifier
    operation: string
  }>()

  /** Fires when the course home on screen changes, or goes out of sight. */
  public readonly onDidChange = this._changed.event

  /** Fires with a failure the course home of its course should show. */
  public readonly onDidFail = this._failed.event

  /** Fires when an operation whose failure {@link onDidFail} reported has succeeded. */
  public readonly onDidClearFailures = this._failuresCleared.event

  /** The course whose home is on screen, if any. */
  public get courseId(): CourseIdentifier | undefined {
    return this._courseId
  }

  public set(courseId: CourseIdentifier | undefined): void {
    const isSame =
      courseId === undefined
        ? this._courseId === undefined
        : this._courseId !== undefined && CourseIdentifierNs.equals(this._courseId, courseId)
    this._courseId = courseId
    if (!isSame) {
      this._changed.fire()
    }
  }

  public isShowing(courseId: CourseIdentifier): boolean {
    return this._courseId !== undefined && CourseIdentifierNs.equals(this._courseId, courseId)
  }

  /** The course home of `courseId` as the {@link FailureSink} of work the student did not start there. */
  public failureSink(courseId: CourseIdentifier): FailureSink {
    return {
      isVisible: () => this.isShowing(courseId),
      show: (headline, error, tone) => this._failed.fire({ courseId, headline, error, tone }),
      clear: (operation) => this._failuresCleared.fire({ courseId, operation }),
    }
  }
}

export const shownCourseHome = new ShownCourseHome()
