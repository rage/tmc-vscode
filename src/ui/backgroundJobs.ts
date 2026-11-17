import * as vscode from "vscode"

import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/lib"

/** The screen that shows a job, which the status bar spinner opens. */
export type JobScreen =
  | { kind: "courseHome"; courseId: CourseIdentifier }
  | { kind: "results"; exerciseId: ExerciseIdentifier; exerciseUri: vscode.Uri }
  | { kind: "coursesView" }
  | { kind: "testResults" }

/** What {@link BackgroundJobs.run} shows of a job. */
export interface JobOptions {
  /** What the job does, e.g. "Downloading 3 exercises", after "TestMyCode: " in the status bar. */
  label: string
  screen: JobScreen
  /** A job long enough to wait on, whose progress is notified while its screen is hidden. */
  isLong?: boolean
}

/** A job in progress, as the status bar and the progress notifications read it. */
export interface BackgroundJob {
  readonly label: string
  readonly screen: JobScreen
  readonly isLong: boolean
  /** How far along it is, 0..1, once the job has said. */
  readonly fraction: number | undefined
}

/** What a running job can tell about itself. */
export interface JobProgress {
  /** Renames the job, e.g. once a submission has been received and is being graded. */
  relabel: (label: string) => void
  /** @param fraction 0..1. */
  report: (fraction: number) => void
}

interface RunningJob {
  label: string
  screen: JobScreen
  isLong: boolean
  fraction: number | undefined
}

/**
 * The jobs the extension runs that the student waits on or did not start: refreshes, update
 * checks, downloads, updates, test runs and submissions until they are graded. The status bar
 * and the progress notifications show them.
 */
export class BackgroundJobs {
  private readonly _running: RunningJob[] = []
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires whenever a job starts, ends, is relabelled or reports progress. */
  public readonly onDidChange = this._changed.event

  /** The jobs in progress, the one started last at the end. */
  public get running(): readonly BackgroundJob[] {
    return this._running
  }

  /** Runs `body` as a job, which ends when `body` settles. */
  public async run<T>(
    options: JobOptions,
    body: (progress: JobProgress) => Promise<T>,
  ): Promise<T> {
    const job: RunningJob = {
      label: options.label,
      screen: options.screen,
      isLong: options.isLong ?? false,
      fraction: undefined,
    }
    this._running.push(job)
    this._changed.fire()
    try {
      return await body({
        relabel: (label) => {
          job.label = label
          this._changed.fire()
        },
        report: (fraction) => {
          job.fraction = fraction
          this._changed.fire()
        },
      })
    } finally {
      this._running.splice(this._running.indexOf(job), 1)
      this._changed.fire()
    }
  }
}

/** The one registry every background job runs through. */
export const backgroundJobs = new BackgroundJobs()
