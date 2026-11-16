import * as vscode from "vscode"

import type { ExerciseSection, ExerciseSubmissionPanel, SubmissionView } from "../../shared/lib"
import { ExerciseIdentifier } from "../../shared/lib"

/** A view of a submission, for the side panel showing `panel`. */
export interface SubmissionViewUpdate {
  panel: ExerciseSubmissionPanel
  view: SubmissionView
  /** Whether the student should see this view even if the side panel is closed or elsewhere. */
  shouldReopen: boolean
}

/** A student's request to see a submission panel, from a command rather than a submit. */
export interface SubmissionPanelReveal {
  panel: ExerciseSubmissionPanel
  /** The section to open and focus. */
  section?: { name: ExerciseSection; shouldPaste: boolean; serial: number } | undefined
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
  private readonly _cleared = new vscode.EventEmitter<void>()
  private readonly _revealed = new vscode.EventEmitter<SubmissionPanelReveal>()
  private _shown: ExerciseSubmissionPanel | undefined
  private _sectionSerial = 0

  /** Fires with a new submission's panel, which the side panel then shows. */
  public readonly onDidOpen = this._opened.event

  public readonly onDidUpdate = this._updated.event

  /** Fires after {@link clear}; whatever shows a submission should close. */
  public readonly onDidClear = this._cleared.event

  /** Fires for {@link reveal}; the side panel then shows the panel, focused. */
  public readonly onDidRequestReveal = this._revealed.event

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

  /** Forgets every submission, as when the account that made them logs out. */
  public clear(): void {
    this._latest.clear()
    this._cleared.fire()
  }

  /**
   * Shows `panel` because the student asked to, with `section` open when given. The panel
   * shows the view it was last updated with.
   */
  public reveal(
    panel: ExerciseSubmissionPanel,
    section?: { name: ExerciseSection; shouldPaste: boolean },
  ): void {
    this._sectionSerial += 1
    this._revealed.fire({
      panel,
      section: section && { ...section, serial: this._sectionSerial },
    })
  }

  /** The latest panel of `exerciseId` and its view, unless every one has been superseded. */
  public latestFor(exerciseId: ExerciseIdentifier): SubmissionViewUpdate | undefined {
    const key = ExerciseIdentifier.key(exerciseId)
    return [...this._latest.values()].findLast(
      ({ panel }) => ExerciseIdentifier.key(panel.exerciseId) === key,
    )
  }

  /** Records the panel on screen in the side panel, or `undefined` when none is visible. */
  public setShown(panel: ExerciseSubmissionPanel | undefined): void {
    this._shown = panel
  }

  /** The panel of `exerciseId` the student can see now, if any. */
  public shownFor(exerciseId: ExerciseIdentifier): ExerciseSubmissionPanel | undefined {
    const shown = this._shown
    return shown && ExerciseIdentifier.key(shown.exerciseId) === ExerciseIdentifier.key(exerciseId)
      ? shown
      : undefined
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
