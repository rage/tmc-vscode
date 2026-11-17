import * as vscode from "vscode"

import type { ExerciseSection, ExerciseSubmissionPanel, SubmissionView } from "../../shared/lib"
import { ExerciseIdentifier } from "../../shared/lib"
import type { FailureSink } from "../api/withOperation"

/** A view of a submission, for the side panel showing `panel`. */
export interface SubmissionViewUpdate {
  panel: ExerciseSubmissionPanel
  view: SubmissionView
  /** Whether the student should see this view even if the side panel is closed or elsewhere. */
  shouldReopen: boolean
}

/** A failure of a command run on an exercise, for its results screen. */
export interface ExerciseFailure {
  exerciseId: ExerciseIdentifier
  headline: string
  error: Error | undefined
  tone: "error" | "warning"
}

/** Failures of `operation` on an exercise that its results screen should take back. */
export interface ExerciseFailuresCleared {
  exerciseId: ExerciseIdentifier
  operation: string
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
  private readonly _failed = new vscode.EventEmitter<ExerciseFailure>()
  private readonly _failuresCleared = new vscode.EventEmitter<ExerciseFailuresCleared>()
  private readonly _shownChanged = new vscode.EventEmitter<void>()
  private _shown: ExerciseSubmissionPanel | undefined
  private _sectionSerial = 0

  /**
   * Fires with a panel the side panel then shows without taking the focus: a new submission's,
   * or one {@link show} names.
   */
  public readonly onDidOpen = this._opened.event

  public readonly onDidUpdate = this._updated.event

  /** Fires after {@link clear}; whatever shows a submission should close. */
  public readonly onDidClear = this._cleared.event

  /** Fires for {@link reveal}; the side panel then shows the panel, focused. */
  public readonly onDidRequestReveal = this._revealed.event

  /** Fires with a failure the exercise's results screen should show; see {@link failureSink}. */
  public readonly onDidFail = this._failed.event

  /** Fires when an operation whose failure {@link onDidFail} reported has succeeded. */
  public readonly onDidClearFailures = this._failuresCleared.event

  /** Fires when the panel on screen in the side panel changes, or goes out of sight. */
  public readonly onDidChangeShown = this._shownChanged.event

  /** Announces a new submission, forgetting earlier submissions of the same exercise. */
  public open(panel: ExerciseSubmissionPanel): void {
    for (const [id, { panel: earlier }] of this._latest) {
      if (isSameExercise(earlier, panel)) {
        this._latest.delete(id)
      }
    }
    this._opened.fire(panel)
  }

  /** Shows `panel` with the view it was last updated with, leaving the focus where it is. */
  public show(panel: ExerciseSubmissionPanel): void {
    this._opened.fire(panel)
  }

  public update(update: SubmissionViewUpdate): void {
    this._latest.set(update.panel.id, update)
    this._updated.fire(update)
  }

  /**
   * Replaces each submission's latest view with what `replacement` makes of it, if anything,
   * telling the side panel as {@link update} does but reopening nothing.
   */
  public replaceLatest(
    replacement: (update: SubmissionViewUpdate) => SubmissionView | undefined,
  ): void {
    for (const latest of this._latest.values()) {
      const view = replacement(latest)
      if (view !== undefined) {
        this.update({ panel: latest.panel, view, shouldReopen: false })
      }
    }
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
    const isSame = panel?.id === this._shown?.id
    this._shown = panel
    if (!isSame) {
      this._shownChanged.fire()
    }
  }

  /** The panel of `exerciseId` the student can see now, if any. */
  public shownFor(exerciseId: ExerciseIdentifier): ExerciseSubmissionPanel | undefined {
    const shown = this._shown
    return shown && ExerciseIdentifier.key(shown.exerciseId) === ExerciseIdentifier.key(exerciseId)
      ? shown
      : undefined
  }

  /**
   * The results screen of `exerciseId` as the {@link FailureSink} of a command run on the
   * exercise: on screen only while the side panel shows that exercise.
   */
  public failureSink(exerciseId: ExerciseIdentifier): FailureSink {
    return {
      isVisible: () => this.shownFor(exerciseId) !== undefined,
      show: (headline, error, tone) => this._failed.fire({ exerciseId, headline, error, tone }),
      clear: (operation) => this._failuresCleared.fire({ exerciseId, operation }),
    }
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
