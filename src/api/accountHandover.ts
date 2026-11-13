import type * as vscode from "vscode"

/** The single owner that versions before shared ownership stored; read only as a fallback. */
const EXERCISES_ACCOUNT_KEY = "exercisesAccountId"
const EXERCISES_ACCOUNTS_KEY = "exercisesAccountIds"
const MOVED_ASIDE_KEY = "movedAsideExercises"

/** A folder that exercises were moved aside to, and the accounts they belonged to. */
export interface MovedAsideExercises {
  folder: string
  accountIds: string[]
}

/**
 * Remembers, across windows and restarts, which courses.mooc.fi accounts the exercises on disk
 * belong to, so a login by another account on the same computer can be told apart, and where
 * exercises moved aside for such a login went.
 */
export class AccountHandover {
  public constructor(private readonly _memento: vscode.Memento) {}

  /**
   * The accounts the exercises on disk belong to: the one that downloaded them, plus any that
   * chose to keep them as their own. Empty before any login recorded one.
   */
  public get exercisesAccountIds(): string[] {
    const accountIds = this._memento.get<string[]>(EXERCISES_ACCOUNTS_KEY)
    if (accountIds) {
      return accountIds
    }
    const legacy = this._memento.get<string>(EXERCISES_ACCOUNT_KEY)
    return legacy === undefined ? [] : [legacy]
  }

  public async setExercisesAccountIds(accountIds: string[]): Promise<void> {
    await this._memento.update(EXERCISES_ACCOUNTS_KEY, accountIds)
    await this._memento.update(EXERCISES_ACCOUNT_KEY, undefined)
  }

  public async addExercisesAccountId(accountId: string): Promise<void> {
    const accountIds = this.exercisesAccountIds
    if (!accountIds.includes(accountId)) {
      await this.setExercisesAccountIds([...accountIds, accountId])
    }
  }

  /** Every folder exercises were moved aside to and not brought back from, oldest first. */
  public get movedAside(): MovedAsideExercises[] {
    return this._memento.get<MovedAsideExercises[]>(MOVED_ASIDE_KEY) ?? []
  }

  public async recordMovedAside(moved: MovedAsideExercises): Promise<void> {
    await this._memento.update(MOVED_ASIDE_KEY, [...this.movedAside, moved])
  }

  public async forgetMovedAside(folder: string): Promise<void> {
    await this._memento.update(
      MOVED_ASIDE_KEY,
      this.movedAside.filter((moved) => moved.folder !== folder),
    )
  }
}
