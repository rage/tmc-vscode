import * as vscode from "vscode"

import { WorkspaceUntrustedError } from "../errors"
import { Logger } from "../utilities"

/**
 * How long after a refusal granting trust still runs the refused operation, and how long the
 * offer to run it stays good once asked.
 */
const RETRY_WINDOW_MS = 5 * 60 * 1000

/** A question to ask before retrying an operation that sends something to a backend. */
export interface RetryOffer {
  message: string
  /** The button that retries the operation. */
  action: string
  /** Says the button came too late to retry, and how to run the operation again. */
  expiredMessage: string
}

async function askInNotification({ message, action }: RetryOffer): Promise<boolean> {
  return (await vscode.window.showInformationMessage(message, action)) === action
}

/**
 * Holds back whatever runs or submits exercise code while the window is in Restricted Mode, and
 * runs the latest refused operation again once the user trusts the workspace.
 */
export class WorkspaceTrustGate implements vscode.Disposable {
  private _pendingRetry:
    | { retry: () => void; offer: RetryOffer | undefined; refusedAt: number }
    | undefined
  private readonly _grantListener: vscode.Disposable

  public constructor(
    private readonly _isTrusted: () => boolean = () => vscode.workspace.isTrusted,
    private readonly _now: () => number = Date.now,
    private readonly _ask: (offer: RetryOffer) => Promise<boolean> = askInNotification,
    private readonly _tell: (message: string) => void = (message) =>
      void vscode.window.showInformationMessage(message),
  ) {
    this._grantListener = vscode.workspace.onDidGrantWorkspaceTrust(() => this._onGrant())
  }

  /**
   * Why the operation must not run now, or `undefined` when it may.
   *
   * @param retry Runs the operation again, the way the user started it. Replaces any earlier
   * refusal's: only the latest one is retried.
   * @param offer Asks this before `retry` runs, for an operation the user must not be surprised
   * by, such as a submission that spends a try.
   */
  public refusal(retry?: () => void, offer?: RetryOffer): WorkspaceUntrustedError | undefined {
    if (this._isTrusted()) {
      return undefined
    }
    if (retry) {
      this._pendingRetry = { retry, offer, refusedAt: this._now() }
    }
    return new WorkspaceUntrustedError(
      "This course workspace is in Restricted Mode, so TestMyCode can't run, submit or share" +
        " exercise code. Trust the course workspace to continue.",
    )
  }

  public dispose(): void {
    this._grantListener.dispose()
  }

  private _onGrant(): void {
    const pending = this._pendingRetry
    this._pendingRetry = undefined
    if (!pending || this._now() - pending.refusedAt > RETRY_WINDOW_MS) {
      return
    }
    const { retry, offer } = pending
    if (!offer) {
      Logger.info("Workspace trusted, retrying the operation it held back.")
      retry()
      return
    }
    const askedAt = this._now()
    // VS Code cannot withdraw a notification, so its button stays clickable in the center.
    void this._ask(offer).then((isAccepted) => {
      if (!isAccepted) {
        return
      }
      if (this._now() - askedAt > RETRY_WINDOW_MS) {
        Logger.info("Workspace trusted, but the offer to retry was accepted after it expired.")
        this._tell(offer.expiredMessage)
        return
      }
      Logger.info("Workspace trusted, retrying the operation it held back as asked.")
      retry()
    })
  }
}
