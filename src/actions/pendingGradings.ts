import type * as vscode from "vscode"

import { ExerciseIdentifier } from "../../shared/lib"

const PENDING_GRADINGS_KEY = "pendingMoocGradings"

/** A mooc submission whose grading the student has not seen, kept across reloads. */
export interface PendingGrading {
  taskSubmissionId: string
  exercisePageUrl: string | undefined
  /** The courses.mooc.fi account that submitted it, when the session named one. */
  accountId: string | undefined
}

/**
 * The newest ungraded submission of each mooc exercise, so a results screen opened after a reload
 * can go on waiting for it instead of showing the exercise as not passed.
 */
class PendingGradings {
  private _memento: vscode.Memento | undefined

  /** Called once at activation with the extension's `globalState`. */
  public attach(memento: vscode.Memento): void {
    this._memento = memento
  }

  /** The pending grading of `exerciseId` submitted by `accountId`; another account's is kept. */
  public get(
    exerciseId: ExerciseIdentifier,
    accountId: string | undefined,
  ): PendingGrading | undefined {
    const pending = this._all()[ExerciseIdentifier.key(exerciseId)]
    return pending?.accountId === accountId ? pending : undefined
  }

  public async set(exerciseId: ExerciseIdentifier, pending: PendingGrading): Promise<void> {
    await this._memento?.update(PENDING_GRADINGS_KEY, {
      ...this._all(),
      [ExerciseIdentifier.key(exerciseId)]: pending,
    })
  }

  public async delete(exerciseId: ExerciseIdentifier): Promise<void> {
    const all = this._all()
    const key = ExerciseIdentifier.key(exerciseId)
    if (key in all) {
      const { [key]: _removed, ...rest } = all
      await this._memento?.update(PENDING_GRADINGS_KEY, rest)
    }
  }

  private _all(): Record<string, PendingGrading> {
    return this._memento?.get<Record<string, PendingGrading>>(PENDING_GRADINGS_KEY) ?? {}
  }
}

export const pendingGradings = new PendingGradings()
