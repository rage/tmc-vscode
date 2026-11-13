import type * as vscode from "vscode"

import { ExerciseIdentifier } from "../../shared/lib"

const KEPT_COPIES_KEY = "keptCopies"

/**
 * Where a copy of an exercise's student files already exists: the template a reset brings
 * back (`download`, `reset`), or the backend (`restore`, `submission`, `backup`).
 */
export type KeptCopy = "download" | "reset" | "restore" | "submission" | "backup"

/** A paste and the student files it sent. */
export interface KeptPaste {
  fingerprint: string
  link: string
}

interface ExerciseCopies {
  /** The newest fingerprint of each kind of copy. */
  copies: Partial<Record<KeptCopy, string>>
  paste?: KeptPaste
}

type CopiesByExercise = Record<string, ExerciseCopies>

/**
 * Remembers, across windows and restarts, which states of each exercise's student files
 * already have a copy, so the extension does not offer or make another one.
 *
 * Fingerprints come from `fingerprintStudentFiles`. They belong to the logged-in account:
 * {@link clear} them when the files on disk stop being that account's.
 */
export class KeptCopies {
  public constructor(private readonly _memento: vscode.Memento) {}

  /** Records `fingerprint` as the newest copy of kind `copy`; `undefined` records nothing. */
  public async record(
    id: ExerciseIdentifier,
    copy: KeptCopy,
    fingerprint: string | undefined,
  ): Promise<void> {
    if (fingerprint === undefined) {
      return
    }
    await this._update(id, (exercise) => ({
      ...exercise,
      copies: { ...exercise.copies, [copy]: fingerprint },
    }))
  }

  public async recordPaste(id: ExerciseIdentifier, paste: KeptPaste): Promise<void> {
    await this._update(id, (exercise) => ({ ...exercise, paste }))
  }

  /**
   * A copy of the student files whose fingerprint is `fingerprint`, preferring one on the
   * backend, or `undefined` when none is known.
   */
  public copyOf(id: ExerciseIdentifier, fingerprint: string | undefined): KeptCopy | undefined {
    if (fingerprint === undefined) {
      return undefined
    }
    const { copies } = this._exercise(id)
    const preference: KeptCopy[] = ["submission", "backup", "restore", "reset", "download"]
    return preference.find((copy) => copies[copy] === fingerprint)
  }

  /** The link of the exercise's last paste, when it sent the files `fingerprint` names. */
  public pasteLink(id: ExerciseIdentifier, fingerprint: string | undefined): string | undefined {
    const { paste } = this._exercise(id)
    return fingerprint !== undefined && paste?.fingerprint === fingerprint ? paste.link : undefined
  }

  /** Forgets every exercise's copies. */
  public async clear(): Promise<void> {
    await this._memento.update(KEPT_COPIES_KEY, undefined)
  }

  private _exercise(id: ExerciseIdentifier): ExerciseCopies {
    return this._all()[ExerciseIdentifier.key(id)] ?? { copies: {} }
  }

  private _all(): CopiesByExercise {
    return this._memento.get<CopiesByExercise>(KEPT_COPIES_KEY) ?? {}
  }

  private async _update(
    id: ExerciseIdentifier,
    change: (exercise: ExerciseCopies) => ExerciseCopies,
  ): Promise<void> {
    const all = this._all()
    const key = ExerciseIdentifier.key(id)
    await this._memento.update(KEPT_COPIES_KEY, {
      ...all,
      [key]: change(all[key] ?? { copies: {} }),
    })
  }
}
