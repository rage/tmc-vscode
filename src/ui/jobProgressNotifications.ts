import * as vscode from "vscode"

import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/lib"
import type Dialog from "../api/dialog"
import type { FractionProgress } from "../api/dialog"
import type { BackgroundJob, BackgroundJobs, JobScreen } from "./backgroundJobs"

/** What tells whether the screen of a job is in sight. */
export interface JobScreens {
  isCourseHomeVisible: (courseId: CourseIdentifier) => boolean
  isResultsVisible: (exerciseId: ExerciseIdentifier) => boolean
  isCoursesViewVisible: () => boolean
  /** Fires whenever any of the above may have changed. */
  onDidChange: vscode.Event<unknown>
}

/**
 * How long a job's screen must stay out of sight before its notification shows: a submit opens its
 * results screen a moment after the job starts, and a job that ends sooner needs none.
 */
const SHOW_DELAY_MS = 1000

interface OpenNotification {
  update: (job: BackgroundJob) => void
  close: () => void
}

/**
 * Shows each long job's progress in a notification while the screen that shows the job is out of
 * sight, and removes it when the screen returns or the job ends. The status bar spinner alone is
 * easy to miss.
 */
export class JobProgressNotifications implements vscode.Disposable {
  private readonly _open = new Map<BackgroundJob, OpenNotification>()
  private readonly _due = new Map<BackgroundJob, ReturnType<typeof setTimeout>>()
  private readonly _subscriptions: vscode.Disposable[]

  public constructor(
    private readonly _dialog: Pick<Dialog, "progressNotification">,
    private readonly _jobs: Pick<BackgroundJobs, "running" | "onDidChange">,
    private readonly _screens: JobScreens,
  ) {
    const sync = (): void => this._sync()
    this._subscriptions = [_jobs.onDidChange(sync), _screens.onDidChange(sync)]
    this._sync()
  }

  public dispose(): void {
    vscode.Disposable.from(...this._subscriptions).dispose()
    for (const timer of this._due.values()) {
      clearTimeout(timer)
    }
    this._due.clear()
    for (const notification of this._open.values()) {
      notification.close()
    }
    this._open.clear()
  }

  private _sync(): void {
    const running = new Set(this._jobs.running)
    const isNotified = (job: BackgroundJob): boolean =>
      running.has(job) && job.isLong && !this._isOnScreen(job.screen)
    for (const [job, notification] of this._open) {
      if (!isNotified(job)) {
        notification.close()
        this._open.delete(job)
      }
    }
    for (const [job, timer] of this._due) {
      if (!isNotified(job)) {
        clearTimeout(timer)
        this._due.delete(job)
      }
    }
    for (const job of running) {
      const open = this._open.get(job)
      if (open) {
        open.update(job)
      } else if (isNotified(job) && !this._due.has(job)) {
        const timer = setTimeout(() => {
          this._due.delete(job)
          this._open.set(job, this._show(job))
        }, SHOW_DELAY_MS)
        this._due.set(job, timer)
      }
    }
  }

  private _isOnScreen(screen: JobScreen): boolean {
    switch (screen.kind) {
      case "courseHome":
        return this._screens.isCourseHomeVisible(screen.courseId)
      case "results":
        return this._screens.isResultsVisible(screen.exerciseId)
      case "coursesView":
        return this._screens.isCoursesViewVisible()
      case "testResults":
        return false
    }
  }

  private _show(job: BackgroundJob): OpenNotification {
    const closed = Promise.withResolvers<void>()
    let progress: vscode.Progress<FractionProgress> | undefined
    let shown = { label: job.label, fraction: job.fraction }
    const report = (): void =>
      progress?.report({ message: shown.label, fraction: shown.fraction ?? 0 })
    void this._dialog.progressNotification(job.label, async (started) => {
      progress = started
      report()
      await closed.promise
    })
    return {
      update: ({ label, fraction }) => {
        if (label !== shown.label || fraction !== shown.fraction) {
          shown = { label, fraction }
          report()
        }
      },
      close: () => closed.resolve(),
    }
  }
}
