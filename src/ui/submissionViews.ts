import * as vscode from "vscode"

import type { ExerciseSubmissionPanel, SubmissionView } from "../shared/shared"

/** A view of a submission, for the side panel showing `panel`. */
export interface SubmissionViewUpdate {
  panel: ExerciseSubmissionPanel
  view: SubmissionView
  /** Whether to reopen the side panel on `panel` if the student closed it. */
  shouldReopen: boolean
}

/**
 * Carries submissions and their views from the submit actions to the side panel, which
 * subscribes at activation, so the actions need not know the panel.
 */
class SubmissionViews {
  private readonly _opened = new vscode.EventEmitter<ExerciseSubmissionPanel>()
  private readonly _updated = new vscode.EventEmitter<SubmissionViewUpdate>()

  /** Fires with a new submission's panel, which the side panel then shows. */
  public readonly onDidOpen = this._opened.event

  public readonly onDidUpdate = this._updated.event

  public open(panel: ExerciseSubmissionPanel): void {
    this._opened.fire(panel)
  }

  public update(update: SubmissionViewUpdate): void {
    this._updated.fire(update)
  }
}

export const submissionViews = new SubmissionViews()
