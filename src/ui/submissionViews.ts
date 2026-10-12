import * as vscode from "vscode"

import type { ExerciseSubmissionPanel, SubmissionView } from "../shared/shared"
import { ExerciseIdentifier } from "../shared/shared"

/** A view of a submission, for the side panel showing `panel`. */
export interface SubmissionViewUpdate {
  panel: ExerciseSubmissionPanel
  view: SubmissionView
  /** Whether the student should see this view even if the side panel is closed or elsewhere. */
  shouldReopen: boolean
}

/**
 * Carries submissions and their views from the submit actions to the side panel, which
 * subscribes at activation, so the actions need not know the panel.
 *
 * Keeps each submission's latest view, so one the side panel is not showing can be shown later.
 */
class SubmissionViews {
  private readonly _opened = new vscode.EventEmitter<ExerciseSubmissionPanel>()
  private readonly _updated = new vscode.EventEmitter<SubmissionViewUpdate>()
  private readonly _latest = new Map<number, SubmissionViewUpdate>()

  /** Fires with a new submission's panel, which the side panel then shows. */
  public readonly onDidOpen = this._opened.event

  public readonly onDidUpdate = this._updated.event

  /** Announces a new submission, forgetting earlier submissions of the same exercise. */
  public open(panel: ExerciseSubmissionPanel): void {
    for (const [id, { panel: earlier }] of this._latest) {
      if (isSameExercise(earlier, panel)) {
        this._latest.delete(id)
      }
    }
    this._opened.fire(panel)
  }

  public update(update: SubmissionViewUpdate): void {
    this._latest.set(update.panel.id, update)
    this._updated.fire(update)
  }

  /** The view submission panel `panelId` was last updated with, unless it has been superseded. */
  public latestView(panelId: number): SubmissionView | undefined {
    return this._latest.get(panelId)?.view
  }
}

/** Whether two submission panels show submissions of one exercise. */
export function isSameExercise(a: ExerciseSubmissionPanel, b: ExerciseSubmissionPanel): boolean {
  return ExerciseIdentifier.key(a.exerciseId) === ExerciseIdentifier.key(b.exerciseId)
}

export const submissionViews = new SubmissionViews()
