import type { Disposable, Webview, WebviewOptions, WebviewPanel } from "vscode"
import { Uri, ViewColumn, window } from "vscode"
import type * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type { ExtensionToWebview } from "../shared/shared"
import { WebviewStateSchema } from "../shared/shared"
import { Logger } from "../utilities"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { messageHandlers } from "./handlers"
import { postMessageToWebview, renderPanel } from "./panel"
import type { HandlerContext, PanelHost } from "./router"
import { dispatch } from "./router"
import type { PanelRoute } from "./routes"
import { nextPanelId, panelTitle } from "./routes"

export { nextPanelId } from "./routes"

/**
 * The main panel's webview type, which its serializer is registered for.
 *
 * Namespaced, as webview types are one registry shared by every extension. package.json's
 * `onWebviewPanel:` activation event must name it.
 */
export const MAIN_PANEL_VIEW_TYPE = "tmc.mainPanel"

// No serializer: a submission's view lives only in this extension host's memory.
const SIDE_PANEL_VIEW_TYPE = "tmc.sidePanel"

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

  // Until "ready", messages are only buffered: that handshake is the single path that
  // renders a panel, for a new document and one reloaded after being hidden alike.
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
    // messages that use one (setCourseDisabledStatus) are posted once per course, so they
    // would all collapse onto one key and only the last would survive; the course data a
    // reloaded panel asks for carries the same state.
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

  // renders the `route` in the side panel, without taking focus: submission results appear
  // while the student is typing, and must not pull their keystrokes away
  public static renderSide(
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: PanelRoute,
  ): void {
    if (TmcPanel.sidePanel !== undefined) {
      Logger.info(`Revealing existing side panel for "${route.type}"`)
      TmcPanel.sidePanel._render(route)
      TmcPanel.sidePanel._panel.reveal(undefined, true)
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
      : { viewColumn: ViewColumn.Beside, preserveFocus: true }
    const panelViewType = isMain ? MAIN_PANEL_VIEW_TYPE : SIDE_PANEL_VIEW_TYPE
    const webviewPanel = window.createWebviewPanel(panelViewType, "TestMyCode", showOptions, {
      ...webviewOptions(extensionUri),
      enableFindWidget: true,
    })
    return TmcPanel._adopt(
      webviewPanel,
      extensionUri,
      extensionContext,
      actionContext,
      route,
      isMain,
    )
  }

  /**
   * Reopens the main panel VS Code restores after a window reload, on the screen its webview
   * saved. One whose screen cannot be shown any more is closed instead.
   */
  public static registerSerializer(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
  ): Disposable {
    return window.registerWebviewPanelSerializer(MAIN_PANEL_VIEW_TYPE, {
      deserializeWebviewPanel: async (webviewPanel, state) => {
        const route = restoredRoute(state, actionContext)
        if (!route || TmcPanel.mainPanel !== undefined) {
          Logger.info("Closing a restored main panel, which has no screen to show")
          webviewPanel.dispose()
          return
        }
        Logger.info(`Restoring the main panel on "${route.type}"`)
        const { extensionUri } = extensionContext
        // The saved options may name an older install's directory.
        webviewPanel.webview.options = webviewOptions(extensionUri)
        TmcPanel.mainPanel = TmcPanel._adopt(
          webviewPanel,
          extensionUri,
          extensionContext,
          actionContext,
          route,
          true,
        )
      },
    })
  }

  private static _adopt(
    webviewPanel: WebviewPanel,
    extensionUri: Uri,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: PanelRoute,
    isMain: boolean,
  ): TmcPanel {
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
    // A hidden webview's document is destroyed; the one VS Code loads on reveal sends "ready".
    this._panel.onDidChangeViewState(
      ({ webviewPanel }) => {
        if (!webviewPanel.visible) {
          this._isWebviewReady = false
        }
      },
      null,
      this._disposables,
    )

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
      renderPanel(route, this._panel.webview)
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
    // Not `_render`, which would clear the buffer about to be resent.
    renderPanel(route, this._panel.webview)
    for (const buffered of this._messageBuffer.values()) {
      postMessageToWebview(this._panel.webview, buffered, this._webviewName)
    }
  }
}

function webviewOptions(extensionUri: Uri): WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [Uri.joinPath(extensionUri, "webview-ui/public/build")],
  }
}

/** The screen a restored main panel's saved `state` names, if it can still be shown. */
function restoredRoute(state: unknown, actionContext: ActionContext): PanelRoute | undefined {
  const saved = WebviewStateSchema.safeParse(state)
  const route = saved.success ? saved.data.route : undefined
  if (route?.type === "CourseDetails") {
    const isCourseStored =
      isReady(actionContext) && actionContext.startup.userData.getCourse(route.courseId).ok
    return isCourseStored ? { id: nextPanelId(), ...route } : undefined
  }
  return route && { id: nextPanelId(), ...route }
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
