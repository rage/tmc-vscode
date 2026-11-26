import * as vscode from "vscode"

import { backendName } from "../../shared/lib"

/** Must match the `authentication` contribution's `id` in package.json. */
export const MOOC_AUTHENTICATION_PROVIDER_ID = "courses-mooc-fi"

const SITE = backendName("mooc")

/**
 * The session the Accounts menu shows, labelled with the account's name once courses.mooc.fi
 * has named it. The CLI owns the real tokens and never hands them out; this one authorizes nothing.
 */
function sessionFor(accountLabel: string | undefined): vscode.AuthenticationSession {
  const label = accountLabel ? `${accountLabel} (${SITE})` : SITE
  return { id: label, accessToken: "", account: { id: label, label }, scopes: [] }
}

/** What the provider drives: the extension's own login state, login and logout. */
export interface MoocAccountActions {
  isLoggedIn: () => boolean
  /** The account's name and email as the student would recognise them, once known. */
  accountLabel: () => string | undefined
  /** Runs the device-flow login, reporting its own failures; resolves whether it succeeded. */
  login: () => Promise<boolean>
  /** Logs out without asking: VS Code has already confirmed the sign-out. */
  logout: () => Promise<void>
}

/**
 * Shows the courses.mooc.fi login in VS Code's Accounts menu, with Sign In and Sign Out.
 *
 * A facade over the CLI's credentials, not a token source: a session's `accessToken` is empty,
 * so an extension granted the session gets nothing it could call courses.mooc.fi with. The
 * session carries no scopes, and one asked for with scopes does not exist.
 */
export class MoocAuthenticationProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  private readonly _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>()
  public readonly onDidChangeSessions = this._onDidChangeSessions.event
  /** The session the Accounts menu was last told about; `undefined` while logged out. */
  private _shown: vscode.AuthenticationSession | undefined

  public constructor(private readonly _account: MoocAccountActions) {
    this._shown = _account.isLoggedIn() ? sessionFor(_account.accountLabel()) : undefined
  }

  public async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    return this._shown && !scopes?.length ? [this._shown] : []
  }

  public async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    if (scopes.length > 0) {
      throw new Error(`${SITE} sessions have no scopes.`)
    }
    if (!(await this._account.login())) {
      throw new Error("You did not log in.")
    }
    this.setLoggedIn(true)
    return this._shown ?? sessionFor(undefined)
  }

  public async removeSession(): Promise<void> {
    await this._account.logout()
  }

  /**
   * Call whenever the login state or the account's name changes, so the Accounts menu follows it.
   * A renamed account replaces the old entry, as VS Code lists each label as its own account.
   */
  public setLoggedIn(isLoggedIn: boolean): void {
    const next = isLoggedIn ? sessionFor(this._account.accountLabel()) : undefined
    const previous = this._shown
    if (next?.id === previous?.id) {
      return
    }
    this._shown = next
    this._onDidChangeSessions.fire({
      added: next ? [next] : [],
      removed: previous ? [previous] : [],
      changed: [],
    })
  }

  public dispose(): void {
    this._onDidChangeSessions.dispose()
  }
}
