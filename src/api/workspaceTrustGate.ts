import * as vscode from "vscode"

import { WorkspaceUntrustedError } from "../errors"
import { Logger } from "../utilities"

/** How long after a refusal granting trust still runs the refused operation. */
const RETRY_WINDOW_MS = 5 * 60 * 1000

/**
 * Holds back whatever runs or submits exercise code while the window is in Restricted Mode, and
 * runs the latest refused operation again once the user trusts the workspace.
 */
export class WorkspaceTrustGate implements vscode.Disposable {
  private _pendingRetry: { retry: () => void; refusedAt: number } | undefined
  private readonly _grantListener: vscode.Disposable

  public constructor(
    private readonly _isTrusted: () => boolean = () => vscode.workspace.isTrusted,
    private readonly _now: () => number = Date.now,
  ) {
    this._grantListener = vscode.workspace.onDidGrantWorkspaceTrust(() => this._onGrant())
  }

  /**
   * Why the operation must not run now, or `undefined` when it may.
   *
   * @param retry Runs the operation again, the way the user started it. Replaces any earlier
   * refusal's: only the latest one is retried.
   */
  public refusal(retry?: () => void): WorkspaceUntrustedError | undefined {
    if (this._isTrusted()) {
      return undefined
    }
    if (retry) {
      this._pendingRetry = { retry, refusedAt: this._now() }
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
    if (pending && this._now() - pending.refusedAt <= RETRY_WINDOW_MS) {
      Logger.info("Workspace trusted, retrying the operation it held back.")
      pending.retry()
    }
  }
}
