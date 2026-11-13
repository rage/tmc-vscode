import type * as vscode from "vscode"

const EXERCISES_ACCOUNT_KEY = "exercisesAccountId"

/**
 * Remembers, across windows and restarts, which courses.mooc.fi account the exercises on disk
 * belong to, so a login by another account on the same computer can be told apart.
 */
export class AccountHandover {
  public constructor(private readonly _memento: vscode.Memento) {}

  /** The account the exercises on disk belong to; `undefined` before any login recorded one. */
  public get exercisesAccountId(): string | undefined {
    return this._memento.get<string>(EXERCISES_ACCOUNT_KEY)
  }

  public async setExercisesAccountId(accountId: string): Promise<void> {
    await this._memento.update(EXERCISES_ACCOUNT_KEY, accountId)
  }
}
