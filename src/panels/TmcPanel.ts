import type { Disposable, Webview, WebviewPanel } from "vscode"
import { Uri, ViewColumn, window } from "vscode"
import type * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import type { ExtensionToWebview } from "../shared/shared"
import { Logger } from "../utilities"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { messageHandlers } from "./handlers"
import { moocLoginRegistry } from "./moocLoginRegistry"
import { postMessageToWebview, renderPanel } from "./panel"
import type { HandlerContext, PanelHost } from "./router"
import { dispatch } from "./router"
import type { PanelRoute } from "./routes"
import { completePanel, panelTitle, takesFocus } from "./routes"

export { nextPanelId } from "./routes"

/**
 * Manages the extension's two webview panels: their lifecycle, and the transport to and
 * from each. What a message does is up to its handler in `./handlers`.
 */
export class TmcPanel {
  // primary panel that most data is displayed in
  public static mainPanel: TmcPanel | undefined

  // extra panel for situations where we want to render another view beside the main one
  public static sidePanel: TmcPanel | undefined

  private readonly _panel: WebviewPanel

  private readonly _actionContext: ActionContext

  // if true, this is the main panel, otherwise this is the side panel
  private readonly _isMain: boolean

  // resent on "ready" so a reloaded webview can recover. Per-instance: the main and
  // side panels show different panels.
  private _route: PanelRoute | undefined

  // Until the first "ready", messages are only buffered: that handshake is the single
  // path that renders a panel, for a new document and a reloaded one alike.
  private _isWebviewReady = false

  // latest message per type targeted at _route's id, resent after it on "ready"
  // so a reload doesn't lose one-shot results that already fired
  private _messageBuffer = new Map<string, ExtensionToWebview>()

  private _disposables: Disposable[] = []

  // `_panel.dispose()` fires `onDidDispose`, which calls back into `dispose()`
  private _isDisposed = false

  // sends a message to the main and side panels
  public static postMessage(...messages: ExtensionToWebview[]): void {
    for (const message of messages) {
      TmcPanel.mainPanel?._postMessage(message)
      TmcPanel.sidePanel?._postMessage(message)
    }
  }

  /** Tells the two panels' log lines apart. */
  private get _webviewName(): string {
    return this._isMain ? "Main webview" : "Side webview"
  }

  /**
   * Sends `message` to this panel's webview alone, buffering it for a reload.
   *
   * Every reply to a request this webview made goes through here; {@link postMessage}
   * is for messages every open panel should see.
   */
  private _postMessage(message: ExtensionToWebview): void {
    // Only id-carrying targets are buffered. A broadcast target has no id, and the
    // delta messages that use one (setUpdateables, setNewExercises) are posted once
    // per course, so they would all collapse onto one key and only the last would
    // survive; those are restored from the extension's own state instead.
    // A `reply` is left out on top of that: the reloaded webview asks again, and a
    // replayed answer to the request of a page that no longer exists settles nothing.
    if (
      message.type !== "reply" &&
      "id" in message.target &&
      message.target.id === this._route?.id
    ) {
      this._messageBuffer.set(`${message.target.id}:${message.type}`, message)
    }
    this._postTransient(message)
  }

  private _postTransient(message: ExtensionToWebview): void {
    if (!this._isWebviewReady || this._isDisposed) {
      return
    }
    postMessageToWebview(this._panel.webview, message, this._webviewName)
  }

  // renders the `route` in the main panel
  public static renderMain(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: PanelRoute,
  ): void {
    if (TmcPanel.mainPanel !== undefined) {
      Logger.info(`Revealing existing main panel for "${route.type}"`)
      TmcPanel.mainPanel._render(route)
      TmcPanel.mainPanel._panel.reveal(undefined, false)
    } else {
      TmcPanel.mainPanel = TmcPanel.renderNew(
        extensionUri,
        extensionContext,
        actionContext,
        route,
        true,
      )
    }
  }

  // renders the `route` in the side panel
  public static renderSide(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: PanelRoute,
  ): void {
    // Navigating away from an in-flight mooc login abandons it, so kill its CLI
    // process. Exempt for re-entering MoocLogin: the new `moocLogin` handler
    // interrupt-and-replaces the old attempt itself.
    if (route.type !== "MoocLogin") {
      moocLoginRegistry.cancelAll()
    }
    if (TmcPanel.sidePanel !== undefined) {
      Logger.info(`Revealing existing side panel for "${route.type}"`)
      TmcPanel.sidePanel._render(route)
      TmcPanel.sidePanel._panel.reveal(undefined, !takesFocus(route))
    } else {
      TmcPanel.sidePanel = TmcPanel.renderNew(
        extensionUri,
        extensionContext,
        actionContext,
        route,
        false,
      )
    }
  }

  // convenience function for rendering a main/side panel when no main/side panel exists yet
  // otherwise the panel can simply be "revealed" with `panel.reveal`
  public static renderNew(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: PanelRoute,
    isMain: boolean,
  ): TmcPanel {
    const showOptions = isMain
      ? { viewColumn: ViewColumn.One, preserveFocus: false }
      : { viewColumn: ViewColumn.Beside, preserveFocus: !takesFocus(route) }
    const panelViewType = isMain ? "mainPanel" : "sidePanel"
    const webviewPanel = window.createWebviewPanel(panelViewType, "TestMyCode", showOptions, {
      enableScripts: true,
      enableFindWidget: true,
      // A reload would restart MoocLogin's device flow and lose UI-only state (selection,
      // scroll, open parts) that no host registry holds.
      retainContextWhenHidden: true,
      localResourceRoots: [Uri.joinPath(extensionUri, "webview-ui/public/build")],
    })
    webviewPanel.iconPath = {
      light: Uri.joinPath(extensionUri, "media", "TMC-light.svg"),
      dark: Uri.joinPath(extensionUri, "media", "TMC.svg"),
    }
    const currentPanel = new TmcPanel(
      webviewPanel,
      extensionContext,
      extensionUri,
      actionContext,
      isMain,
    )
    currentPanel._render(route)
    return currentPanel
  }

  private constructor(
    panel: WebviewPanel,
    extensionContext: vscode.ExtensionContext,
    extensionUri: Uri,
    actionContext: ActionContext,
    isMain: boolean,
  ) {
    this._panel = panel
    this._actionContext = actionContext
    this._isMain = isMain

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    this._panel.webview.html = webviewContent(this._panel.webview, extensionUri)

    const handlerContext: HandlerContext = {
      host: this._createHost(extensionContext),
      actionContext,
      extensionContext,
    }
    const handlers = {
      ...messageHandlers,
      ready: { requiresReady: false, handle: () => this._onReady() },
    } as const
    this._panel.webview.onDidReceiveMessage(
      (message: unknown) => dispatch(handlers, message, handlerContext),
      undefined,
      this._disposables,
    )
  }

  public dispose(): void {
    if (this._isDisposed) {
      return
    }
    this._isDisposed = true
    this._panel.dispose()

    if (this._isMain) {
      TmcPanel.mainPanel = undefined
    } else {
      TmcPanel.sidePanel = undefined
      // Interrupt any in-flight mooc login on side-panel dispose (close/reload)
      // so no orphaned CLI process keeps polling.
      moocLoginRegistry.cancelAll()
    }

    while (this._disposables.length > 0) {
      const disposable = this._disposables.pop()
      if (disposable) {
        disposable.dispose()
      }
    }
  }

  private _createHost(extensionContext: vscode.ExtensionContext): PanelHost {
    const currentRoute = (): PanelRoute | undefined => this._route
    return {
      name: this._webviewName,
      get route() {
        return currentRoute()
      },
      post: (message) => this._postMessage(message),
      postTransient: (message) => this._postTransient(message),
      render: (route) => this._render(route),
      renderMain: (route) =>
        TmcPanel.renderMain(
          extensionContext.extensionUri,
          extensionContext,
          this._actionContext,
          route,
        ),
      closeSidePanel: () => TmcPanel.sidePanel?.dispose(),
    }
  }

  // remembers `route` so "ready" can (re)send it
  private _render(route: PanelRoute): void {
    this._route = route
    this._messageBuffer.clear()
    this._panel.title = panelTitle(route, this._actionContext)
    if (this._isWebviewReady && !this._isDisposed) {
      renderPanel(completePanel(route, this._actionContext), this._panel.webview)
    }
  }

  private _onReady(): void {
    this._isWebviewReady = true
    const route = this._route
    Logger.info(
      `Received "ready" from ${this._isMain ? "main" : "side"} webview` +
        (route ? `, resending panel "${route.type}"` : ", no panel to resend"),
    )
    if (!route) {
      return
    }
    // Resending MoocLogin deliberately restarts the device flow: the reloaded webview has
    // lost the code it was showing, and MoocLogin's mount posts `moocLogin` again, which
    // interrupts the now-unreachable CLI process.
    // Not `_render`, which would clear the buffer about to be resent.
    renderPanel(completePanel(route, this._actionContext), this._panel.webview)
    for (const buffered of this._messageBuffer.values()) {
      postMessageToWebview(this._panel.webview, buffered, this._webviewName)
    }
  }
}

function webviewContent(webview: Webview, extensionUri: Uri): string {
  const stylesUri = getUri(webview, extensionUri, ["webview-ui", "public", "build", "bundle.css"])
  const scriptUri = getUri(webview, extensionUri, ["webview-ui", "public", "build", "bundle.js"])
  const codiconCssUri = getUri(webview, extensionUri, [
    "webview-ui",
    "public",
    "build",
    "codicon.css",
  ])

  const nonce = getNonce()

  return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <title>TestMyCode</title>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta
                    http-equiv="Content-Security-Policy"
                    content="
                        default-src 'none';
                        img-src ${webview.cspSource};
                        font-src ${webview.cspSource};
                        style-src 'nonce-${nonce}';
                        script-src 'nonce-${nonce}';"
                />
                <meta property="csp-nonce" content="${nonce}" />
                <link nonce="${nonce}" rel="stylesheet" type="text/css" href="${stylesUri}" />
                <!-- id required: vscode-icon clones this stylesheet into each icon's shadow root. -->
                <link
                    nonce="${nonce}"
                    id="vscode-codicon-stylesheet"
                    rel="stylesheet"
                    type="text/css"
                    href="${codiconCssUri}"
                />
                <script defer nonce="${nonce}" src="${scriptUri}"></script>
            </head>
            <body></body>
            </html>
      `
}
