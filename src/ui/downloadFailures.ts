import * as vscode from "vscode"

import { ExerciseIdentifier } from "../shared/shared"

/**
 * Remembers which exercises failed to download.
 *
 * The disk cannot tell a failed download from one never tried, and the Courses view says
 * which it was. The failure shows only while the exercise is still absent, so one
 * downloaded since by any route is no longer failed even if never recorded here.
 */
class DownloadFailures {
  private readonly _failed = new Set<string>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link record} or {@link clear}. */
  public readonly onDidChange = this._changed.event

  public has(exerciseId: ExerciseIdentifier): boolean {
    return this._failed.has(ExerciseIdentifier.key(exerciseId))
  }

  public record(
    failed: readonly ExerciseIdentifier[],
    downloaded: readonly ExerciseIdentifier[],
  ): void {
    for (const id of downloaded) {
      this._failed.delete(ExerciseIdentifier.key(id))
    }
    for (const id of failed) {
      this._failed.add(ExerciseIdentifier.key(id))
    }
    this._changed.fire()
  }

  public clear(): void {
    this._failed.clear()
    this._changed.fire()
  }
}

export const downloadFailures = new DownloadFailures()
