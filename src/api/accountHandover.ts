import type * as vscode from "vscode"

const LOGGED_OUT_KEY = "loggedOutWithExercises"

/**
 * Remembers, across windows and restarts, that the account whose exercises are on disk logged
 * out, so the next login can ask whether they belong to whoever logs in. The backend does not
 * tell the extension which account is logged in, so a logout is the only sign of a handover.
 */
export class AccountHandover {
  public constructor(private readonly _memento: vscode.Memento) {}

  public async recordLogout(): Promise<void> {
    await this._memento.update(LOGGED_OUT_KEY, true)
  }

  /** Whether a logout was recorded since the last call, forgetting it. */
  public async takeLogout(): Promise<boolean> {
    const isRecorded = this._memento.get<boolean>(LOGGED_OUT_KEY) === true
    if (isRecorded) {
      await this._memento.update(LOGGED_OUT_KEY, undefined)
    }
    return isRecorded
  }
}
