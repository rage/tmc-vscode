import * as vscode from "vscode"

/** The courses.mooc.fi session as the account status bar item shows it. */
export type AccountStatus = "loggedIn" | "loggedOut" | "sessionExpired"

interface AccountPresentation {
  text: string
  tooltip: string
  accessibilityLabel: string
  command: string
}

const presentations: Record<AccountStatus, AccountPresentation> = {
  loggedIn: {
    text: "$(account) courses.mooc.fi",
    tooltip: "**TestMyCode**\n\nLogged in with your courses.mooc.fi account.",
    accessibilityLabel: "TestMyCode: logged in with courses.mooc.fi. Show account actions",
    command: "tmc.showAccountMenu",
  },
  loggedOut: {
    text: "$(sign-in) TestMyCode: Log In",
    tooltip: "**TestMyCode**\n\nNot logged in. Log in with your courses.mooc.fi account.",
    accessibilityLabel: "TestMyCode: not logged in. Log in",
    command: "tmc.showMoocLogin",
  },
  sessionExpired: {
    text: "$(warning) TestMyCode: Session Expired",
    tooltip:
      "**TestMyCode**\n\nYour courses.mooc.fi session has expired. Log in again to download and submit exercises.",
    accessibilityLabel: "TestMyCode: session expired. Log in again",
    command: "tmc.showMoocLogin",
  },
}

/**
 * The status bar item that shows whether the user is logged in, and logs them in or offers
 * the account actions when clicked.
 *
 * An expiry stays shown until a login: a later "logged out" answer from a check is the
 * same expired session, not a sign-out.
 */
export class AccountStatusBarItem implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem
  private _status: AccountStatus

  public constructor(isLoggedIn: boolean) {
    this._item = vscode.window.createStatusBarItem("tmc.account", vscode.StatusBarAlignment.Left, 0)
    this._item.name = "TestMyCode Account"
    this._status = isLoggedIn ? "loggedIn" : "loggedOut"
    this._render()
    this._item.show()
  }

  public get status(): AccountStatus {
    return this._status
  }

  /**
   * Follows `AuthState.loggedIn`. Also call with `true` on a courses.mooc.fi login, which ends
   * an expiry even when a tmc session kept `loggedIn` true throughout.
   */
  public setLoggedIn(isLoggedIn: boolean): void {
    if (isLoggedIn) {
      this._setStatus("loggedIn")
    } else if (this._status !== "sessionExpired") {
      this._setStatus("loggedOut")
    }
  }

  /** Call when a session the user had ends without them logging out. */
  public markSessionExpired(): void {
    this._setStatus("sessionExpired")
  }

  public dispose(): void {
    this._item.dispose()
  }

  private _setStatus(status: AccountStatus): void {
    if (status !== this._status) {
      this._status = status
      this._render()
    }
  }

  private _render(): void {
    const presentation = presentations[this._status]
    this._item.text = presentation.text
    this._item.tooltip = new vscode.MarkdownString(presentation.tooltip)
    this._item.accessibilityInformation = { label: presentation.accessibilityLabel }
    this._item.command = presentation.command
  }
}

interface AccountAction extends vscode.QuickPickItem {
  command: string
}

/** Offers what a logged-in user can do with their account, and runs the one they pick. */
export async function showAccountMenu(): Promise<void> {
  const actions: AccountAction[] = [
    { label: "$(book) Show Courses", command: "tmc.myCourses" },
    { label: "$(gear) Open Settings", command: "tmc.settings" },
    { label: "$(sign-out) Log Out", command: "tmc.logout" },
  ]
  const picked = await vscode.window.showQuickPick(actions, {
    title: "TestMyCode Account",
    placeHolder: "Logged in with your courses.mooc.fi account",
  })
  if (picked) {
    await vscode.commands.executeCommand(picked.command)
  }
}
