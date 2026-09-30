import * as vscode from "vscode"

import { backendName } from "../shared/shared"

/** Must match the `authentication` contribution's `id` in package.json. */
export const MOOC_AUTHENTICATION_PROVIDER_ID = "courses-mooc-fi"

const SITE = backendName("mooc")

const SESSION: vscode.AuthenticationSession = {
  id: SITE,
  // The CLI owns the real tokens and never hands them out; this one authorizes nothing.
  accessToken: "",
  account: { id: SITE, label: SITE },
  scopes: [],
}

/** What the provider drives: the extension's own login state, login and logout. */
export interface MoocAccountActions {
  isLoggedIn: () => boolean
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

  public constructor(private readonly _account: MoocAccountActions) {}

  public async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    return this._account.isLoggedIn() && !scopes?.length ? [SESSION] : []
  }

  public async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    if (scopes.length > 0) {
      throw new Error(`${SITE} sessions have no scopes.`)
    }
    if (!(await this._account.login())) {
      throw new Error(`Did not log in to ${SITE}.`)
    }
    return SESSION
  }

  public async removeSession(): Promise<void> {
    await this._account.logout()
  }

  /** Call whenever the courses.mooc.fi login state changes, so the Accounts menu follows it. */
  public setLoggedIn(isLoggedIn: boolean): void {
    this._onDidChangeSessions.fire(
      isLoggedIn
        ? { added: [SESSION], removed: [], changed: [] }
        : { added: [], removed: [SESSION], changed: [] },
    )
  }

  public dispose(): void {
    this._onDidChangeSessions.dispose()
  }
}
