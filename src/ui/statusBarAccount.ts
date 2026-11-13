import * as vscode from "vscode"

import { backendName, SESSION_EXPIRED_DETAIL } from "../../shared/lib"
import type { AuthState } from "../api/authState"
import type Dialog from "../api/dialog"

const SITE = backendName("mooc")

/** The courses.mooc.fi session as the account status bar item shows it. */
type AccountStatus = "loggedIn" | "loggedOut" | "sessionExpired"

interface AccountPresentation {
  text: string
  tooltip: string
  accessibilityLabel: string
  command: string
}

/** What the item shows of `AuthState`. */
type AccountState = Pick<AuthState, "loggedIn" | "isSessionExpired">

function statusOf({ loggedIn, isSessionExpired }: AccountState): AccountStatus {
  if (isSessionExpired) {
    return "sessionExpired"
  }
  return loggedIn ? "loggedIn" : "loggedOut"
}

const presentations: Record<AccountStatus, AccountPresentation> = {
  loggedIn: {
    text: `$(account) ${SITE}`,
    tooltip: `**TestMyCode**\n\nLogged in with your ${SITE} account.`,
    accessibilityLabel: `TestMyCode: logged in with ${SITE}. Show account actions`,
    command: "tmc.showAccountMenu",
  },
  loggedOut: {
    text: "$(sign-in) TestMyCode: Log In",
    tooltip: `**TestMyCode**\n\nNot logged in. Log in with your ${SITE} account.`,
    accessibilityLabel: "TestMyCode: not logged in. Log in",
    command: "tmc.showMoocLogin",
  },
  sessionExpired: {
    text: "$(warning) TestMyCode: Session Expired",
    tooltip: `**TestMyCode**\n\n${SESSION_EXPIRED_DETAIL}`,
    accessibilityLabel: "TestMyCode: session expired. Log in again",
    command: "tmc.showMoocLogin",
  },
}

/**
 * The status bar item that shows whether the user is logged in, and logs them in or offers the
 * account actions when clicked.
 */
export class AccountStatusBarItem implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem
  private _status: AccountStatus

  public constructor(account: AccountState) {
    this._item = vscode.window.createStatusBarItem("tmc.account", vscode.StatusBarAlignment.Left, 0)
    this._item.name = "TestMyCode Account"
    this._status = statusOf(account)
    this._render()
    this._item.show()
  }

  /** Follows `AuthState`. */
  public update(account: AccountState): void {
    this._setStatus(statusOf(account))
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

/** Offers what a logged-in user can do with their account, and runs the one they pick. */
export async function showAccountMenu(dialog: Dialog): Promise<void> {
  const command = await dialog.selectItem(
    { title: "TestMyCode Account", placeHolder: `Logged in with your ${SITE} account` },
    { label: "$(book) Show Courses", value: "tmc.myCourses" },
    { label: "$(gear) Open Settings", value: "tmc.settings" },
    { label: "$(sign-out) Log Out", value: "tmc.logout" },
  )
  if (command) {
    await vscode.commands.executeCommand(command)
  }
}
