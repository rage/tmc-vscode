import * as vscode from "vscode"

import type { CourseIdentifier } from "../shared/lib"
import { OPEN_COURSE_FOCUS_REFRESH_INTERVAL, OPEN_COURSE_POLL_INTERVAL } from "./config/constants"

/** What {@link OpenCourseRefresh} reads and runs. */
export interface OpenCourseRefreshSources {
  /** The course whose workspace the window has open, while the student is logged in. */
  openCourse: () => CourseIdentifier | undefined
  /** Refreshes that one course, without waiting for it. */
  refresh: (courseId: CourseIdentifier) => void
}

/**
 * Checks the course whose workspace is open for new exercises more often than the full
 * refresh does, as that is where a student waits for the one just published: when the window
 * gets focus back, and periodically while it has focus. A window in the background asks nothing.
 */
export class OpenCourseRefresh implements vscode.Disposable {
  private _lastRefreshAt: number
  private readonly _poll: NodeJS.Timeout
  private readonly _focusListener: vscode.Disposable

  public constructor(
    private readonly _sources: OpenCourseRefreshSources,
    private readonly _now: () => number = Date.now,
  ) {
    this._lastRefreshAt = _now()
    this._poll = setInterval(() => {
      if (vscode.window.state.focused) {
        this._refreshIfOlderThan(OPEN_COURSE_POLL_INTERVAL)
      }
    }, OPEN_COURSE_POLL_INTERVAL)
    this._focusListener = vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        this._refreshIfOlderThan(OPEN_COURSE_FOCUS_REFRESH_INTERVAL)
      }
    })
  }

  /** Call when a refresh of every course starts, which covers the open one too. */
  public noteRefreshed(): void {
    this._lastRefreshAt = this._now()
  }

  public dispose(): void {
    clearInterval(this._poll)
    this._focusListener.dispose()
  }

  private _refreshIfOlderThan(intervalMs: number): void {
    const courseId = this._sources.openCourse()
    if (courseId === undefined || this._now() - this._lastRefreshAt < intervalMs) {
      return
    }
    this._lastRefreshAt = this._now()
    this._sources.refresh(courseId)
  }
}
