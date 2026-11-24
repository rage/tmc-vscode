import * as vscode from "vscode"

import { LOGGED_OUT_MESSAGE } from "../../shared/lib"
import type { AuthState } from "../api/authState"
import type Dialog from "../api/dialog"
import type { Session } from "../api/langs"

/** The courses.mooc.fi session as the account status bar item shows it. */
type AccountStatus = "loggedIn" | "legacyLogin" | "loggedOut" | "sessionExpired"

interface AccountPresentation {
  text: string
  tooltip: string
  accessibilityLabel: string
  command: string
}

/** What the item shows of `AuthState`. */
type AccountState = Pick<AuthState, "loggedIn" | "isSessionExpired" | "session">

function statusOf({ loggedIn, isSessionExpired, session }: AccountState): AccountStatus {
  if (isSessionExpired) {
    return "sessionExpired"
  }
  if (!loggedIn) {
    return "loggedOut"
  }
  return session?.kind === "tmc" ? "legacyLogin" : "loggedIn"
}

/** The account as the student would recognise it: name and email, either, or neither. */
export function accountLabel(session: Session | undefined): string | undefined {
  const account = session?.kind === "mooc" ? session.account : undefined
  const parts = [account?.name, account?.email].filter((part): part is string => !!part)
  if (parts.length === 2) {
    return `${parts[0]} (${parts[1]})`
  }
  return parts[0]
}

const presentations: Record<AccountStatus, AccountPresentation> = {
  loggedIn: {
    text: "$(account) MOOC.fi",
    tooltip: "**TestMyCode**\n\nLogged in with your MOOC.fi account.",
    accessibilityLabel: "TestMyCode: logged in with your MOOC.fi account. Show account actions",
    command: "tmc.showAccountMenu",
  },
  legacyLogin: {
    text: "$(account) tmc.mooc.fi",
    tooltip:
      "**TestMyCode**\n\nLogged in with an old tmc.mooc.fi login. Log in with your MOOC.fi " +
      "account to use courses on courses.mooc.fi too.",
    accessibilityLabel: "TestMyCode: logged in with an old tmc.mooc.fi login. Log in with MOOC.fi",
    command: "tmc.showMoocLogin",
  },
  loggedOut: {
    text: "$(sign-in) TestMyCode: Log In",
    tooltip: "**TestMyCode**\n\nNot logged in. Log in with your MOOC.fi account.",
    accessibilityLabel: "TestMyCode: not logged in. Log in",
    command: "tmc.showMoocLogin",
  },
  sessionExpired: {
    text: "$(warning) TestMyCode: Logged Out",
    tooltip: `**TestMyCode**\n\n${LOGGED_OUT_MESSAGE}`,
    accessibilityLabel: `TestMyCode: ${LOGGED_OUT_MESSAGE}`,
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
  private _label: string | undefined

  public constructor(account: AccountState) {
    this._item = vscode.window.createStatusBarItem("tmc.account", vscode.StatusBarAlignment.Left, 0)
    this._item.name = "TestMyCode Account"
    this._status = statusOf(account)
    this._label = accountLabel(account.session)
    this._render()
    this._item.show()
  }

  /** Follows `AuthState`. */
  public update(account: AccountState): void {
    const label = accountLabel(account.session)
    if (label !== this._label) {
      this._label = label
      this._status = statusOf(account)
      this._render()
      return
    }
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
    const isNamed = this._status === "loggedIn" && this._label !== undefined
    this._item.text = presentation.text
    const tooltip = new vscode.MarkdownString(
      isNamed
        ? `**TestMyCode**\n\nLogged in with the MOOC.fi account of ${this._label}.`
        : presentation.tooltip,
    )
    this._item.tooltip = tooltip
    this._item.accessibilityInformation = {
      label: isNamed
        ? `TestMyCode: logged in as ${this._label}. Show account actions`
        : presentation.accessibilityLabel,
    }
    this._item.command = presentation.command
  }
}

/** Offers what a logged-in user can do with their account, and runs the one they pick. */
export async function showAccountMenu(
  dialog: Dialog,
  session: Session | undefined = undefined,
): Promise<void> {
  const label = accountLabel(session)
  const command = await dialog.selectItem(
    {
      title: "TestMyCode Account",
      placeHolder: label
        ? `Logged in as ${label}`
        : session?.kind === "tmc"
          ? "Logged in with an old tmc.mooc.fi login"
          : "Logged in with your MOOC.fi account",
    },
    ...(session?.kind === "tmc"
      ? [{ label: "$(sign-in) Log In with MOOC.fi", value: "tmc.showMoocLogin" }]
      : []),
    { label: "$(book) Show Courses", value: "tmc.myCourses" },
    { label: "$(gear) Open Settings", value: "tmc.settings" },
    { label: "$(sign-out) Log Out", value: "tmc.logout" },
  )
  if (command) {
    await vscode.commands.executeCommand(command)
  }
}
