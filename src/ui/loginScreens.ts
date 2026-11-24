import * as vscode from "vscode"

import type {
  LoginAction,
  LoginFailure,
  LoginPanel,
  LoginView,
  WebviewError,
} from "../../shared/lib"
import {
  CertificateError,
  ConnectionError,
  DeviceLoginDeniedError,
  DeviceLoginExpiredError,
  presentationFor,
  ProxyError,
  ServerError,
} from "../errors"
import { nextPanelId } from "../panels/routes"
import { toWebviewError } from "../panels/webviewError"

/** What `tmc.showMoocLogin` takes from code; a menu passes it something else. */
export interface LoginOptions {
  /** Go on to the add-course screen after the login even when the user has courses. */
  isAddingCourse?: boolean
}

/** A login screen's new view. */
export interface LoginScreenUpdate {
  panel: LoginPanel
  view: LoginView
}

/** A login screen no longer shown, and whether its panel was closed rather than reused. */
export interface LoginScreenLeave {
  panelId: number
  isClosed: boolean
}

/** A button pressed on a login screen. */
export interface LoginScreenAction {
  panelId: number
  action: LoginAction
}

/**
 * Carries a running login's views to the main panel, and the screen's buttons and its closing
 * back to the login, so neither side needs to know the other. The main panel subscribes at
 * activation.
 */
class LoginScreens {
  private readonly _opened = new vscode.EventEmitter<LoginPanel>()
  private readonly _updated = new vscode.EventEmitter<LoginScreenUpdate>()
  private readonly _closeRequested = new vscode.EventEmitter<LoginPanel>()
  private readonly _left = new vscode.EventEmitter<LoginScreenLeave>()
  private readonly _actionRequested = new vscode.EventEmitter<LoginScreenAction>()
  private _latest: LoginScreenUpdate | undefined

  /** Fires with a new login's panel, which the main panel then shows. */
  public readonly onDidOpen = this._opened.event

  public readonly onDidUpdate = this._updated.event

  /** Fires when a login is done with its screen; the main panel closes it if still shown. */
  public readonly onDidRequestClose = this._closeRequested.event

  /** Fires once the main panel no longer shows a login screen. */
  public readonly onDidLeave = this._left.event

  public readonly onDidRequestAction = this._actionRequested.event

  /** Opens a new login's screen on `view`. */
  public open({ isAddingCourse = false }: LoginOptions, view: LoginView): LoginPanel {
    const panel: LoginPanel = { id: nextPanelId(), type: "Login", isAddingCourse }
    this._latest = { panel, view }
    this._opened.fire(panel)
    return panel
  }

  public update(panel: LoginPanel, view: LoginView): void {
    this._latest = { panel, view }
    this._updated.fire({ panel, view })
  }

  public close(panel: LoginPanel): void {
    this._closeRequested.fire(panel)
  }

  /**
   * For the panel that stopped showing login screen `panelId`.
   *
   * @param isClosed The panel was closed, rather than showing another screen.
   */
  public leave(panelId: number, isClosed = true): void {
    this._left.fire({ panelId, isClosed })
  }

  public requestAction(panelId: number, action: LoginAction): void {
    this._actionRequested.fire({ panelId, action })
  }

  /** The view login screen `panelId` was last sent, if it is the newest login's. */
  public latestView(panelId: number): LoginView | undefined {
    return this._latest?.panel.id === panelId ? this._latest.view : undefined
  }
}

export const loginScreens = new LoginScreens()

/**
 * The login screen's view of a failed login. Only a failure the student did not cause in the
 * browser offers its details.
 */
export function loginFailureView(error: Error): Extract<LoginView, { phase: "failed" }> {
  const [failure, shown] = describeFailure(error)
  return { phase: "failed", failure, error: shown }
}

function describeFailure(error: Error): [LoginFailure, WebviewError] {
  if (error instanceof DeviceLoginDeniedError) {
    return ["denied", { message: "The login was denied in the browser." }]
  }
  if (error instanceof DeviceLoginExpiredError) {
    return ["expired", { message: "The login code expired before it was approved." }]
  }
  const { detailsId } = toWebviewError(error)
  const withDetails = (message: string): WebviewError =>
    detailsId === undefined ? { message } : { message, detailsId }
  if (
    error instanceof ConnectionError &&
    !(error instanceof CertificateError || error instanceof ProxyError)
  ) {
    return [
      "unreachable",
      withDetails("Could not reach the server. Check your internet connection."),
    ]
  }
  if (error instanceof ServerError) {
    return ["serverError", withDetails(presentationFor(error).message)]
  }
  return ["other", withDetails(presentationFor(error).message)]
}
