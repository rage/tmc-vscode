import type { Disposable, Webview, WebviewOptions, WebviewPanel } from "vscode"
import { Uri, ViewColumn, window } from "vscode"
import type * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type { Panel } from "../shared/shared"
import { assertUnreachable, WebviewStateSchema } from "../shared/shared"
import { Logger } from "../utilities"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { messageHandlers } from "./handlers"
import { postMessageToWebview, renderPanel } from "./panel"
import type { HandlerContext, PanelHost, PanelMessage } from "./router"
import { dispatch } from "./router"
import { initializationErrorHelpPanel, nextPanelId, panelTitle } from "./routes"

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
  private _route: Panel | undefined

  // Until "ready", messages are only buffered: that handshake is the single path that
  // renders a panel, for a new document and one reloaded after being hidden alike.
  private _isWebviewReady = false

  // latest message per type targeted at _route's id, resent after it on "ready"
  // so a reload doesn't lose one-shot results that already fired
  private _messageBuffer = new Map<string, PanelMessage>()

  private _disposables: Disposable[] = []

  // `_panel.dispose()` fires `onDidDispose`, which calls back into `dispose()`
  private _isDisposed = false

  /** Sends `message` to the side panel, where submissions are shown. */
  public static postToSidePanel(message: PanelMessage): void {
    TmcPanel.sidePanel?._postMessage(message)
  }

  /** Tells the two panels' log lines apart. */
  private get _webviewName(): string {
    return this._isMain ? "Main webview" : "Side webview"
  }

  /** Sends `message` to this panel's webview alone, buffering it for a reload. */
  private _postMessage(message: PanelMessage): void {
    // A `reply` is left out: the reloaded webview asks again, and a replayed answer to the
    // request of a page that no longer exists settles nothing.
    if (message.type !== "reply" && message.target.id === this._route?.id) {
      this._messageBuffer.set(`${message.target.id}:${message.type}`, message)
    }
    this._postTransient(message)
  }

  private _postTransient(message: PanelMessage): void {
    if (!this._isWebviewReady || this._isDisposed) {
      return
    }
    postMessageToWebview(this._panel.webview, message, this._webviewName)
  }

  /** Shows `route` in the main panel, creating the panel if needed. */
  public static renderMain(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
  ): void {
    TmcPanel._renderIn(true, extensionContext, actionContext, route)
  }

  /**
   * Shows `route` in the side panel without taking focus: submission results appear while the
   * student is typing, and must not pull their keystrokes away.
   */
  public static renderSide(
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
  ): void {
    TmcPanel._renderIn(false, extensionContext, actionContext, route)
  }

  private static _renderIn(
    isMain: boolean,
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
  ): void {
    const existing = isMain ? TmcPanel.mainPanel : TmcPanel.sidePanel
    if (existing !== undefined) {
      Logger.info(`Revealing the ${existing._webviewName} for "${route.type}"`)
      existing._render(route)
      existing._panel.reveal(undefined, !isMain)
      return
    }
    const showOptions = isMain
      ? { viewColumn: ViewColumn.One, preserveFocus: false }
      : { viewColumn: ViewColumn.Beside, preserveFocus: true }
    const panelViewType = isMain ? MAIN_PANEL_VIEW_TYPE : SIDE_PANEL_VIEW_TYPE
    const webviewPanel = window.createWebviewPanel(panelViewType, "TestMyCode", showOptions, {
      ...webviewOptions(extensionContext.extensionUri),
      enableFindWidget: true,
    })
    const created = TmcPanel._adopt(webviewPanel, extensionContext, actionContext, route, isMain)
    if (isMain) {
      TmcPanel.mainPanel = created
    } else {
      TmcPanel.sidePanel = created
    }
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
        const route = restoredRoute(state, actionContext, extensionContext)
        if (!route || TmcPanel.mainPanel !== undefined) {
          Logger.info("Closing a restored main panel, which has no screen to show")
          webviewPanel.dispose()
          return
        }
        Logger.info(`Restoring the main panel on "${route.type}"`)
        // The saved options may name an older install's directory.
        webviewPanel.webview.options = webviewOptions(extensionContext.extensionUri)
        TmcPanel.mainPanel = TmcPanel._adopt(
          webviewPanel,
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
    extensionContext: vscode.ExtensionContext,
    actionContext: ActionContext,
    route: Panel,
    isMain: boolean,
  ): TmcPanel {
    const { extensionUri } = extensionContext
    webviewPanel.iconPath = {
      light: Uri.joinPath(extensionUri, "media", "TMC-light.svg"),
      dark: Uri.joinPath(extensionUri, "media", "TMC.svg"),
    }
    const currentPanel = new TmcPanel(webviewPanel, extensionContext, actionContext, isMain)
    currentPanel._render(route)
    return currentPanel
  }

  private constructor(
    panel: WebviewPanel,
    extensionContext: vscode.ExtensionContext,
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

    this._panel.webview.html = webviewContent(this._panel.webview, extensionContext.extensionUri)

    if (isReady(actionContext)) {
      this._disposables.push(
        actionContext.startup.userData.onDidChangeCourses(() => this._onDidChangeCourses()),
      )
    }

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
    const currentRoute = (): Panel | undefined => this._route
    return {
      name: this._webviewName,
      get route() {
        return currentRoute()
      },
      post: (message) => this._postMessage(message),
      render: (route) => this._render(route),
      renderMain: (route) => TmcPanel.renderMain(extensionContext, this._actionContext, route),
      closeSidePanel: () => TmcPanel.sidePanel?.dispose(),
    }
  }

  /**
   * Keeps a CourseDetails screen and its tab title on the stored course. Not buffered: the
   * screen asks for its course whenever its document loads.
   */
  private _onDidChangeCourses(): void {
    const route = this._route
    if (route?.type !== "CourseDetails" || !isReady(this._actionContext)) {
      return
    }
    const course = this._actionContext.startup.userData.getCourse(route.courseId)
    if (course.err) {
      return
    }
    this._panel.title = panelTitle(route, this._actionContext)
    this._postTransient({
      type: "setCourseData",
      target: { id: route.id, type: route.type },
      courseData: course.val,
    })
  }

  // remembers `route` so "ready" can (re)send it
  private _render(route: Panel): void {
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
      `Received "ready" from the ${this._webviewName}` +
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
function restoredRoute(
  state: unknown,
  actionContext: ActionContext,
  extensionContext: vscode.ExtensionContext,
): Panel | undefined {
  const saved = WebviewStateSchema.safeParse(state)
  const route = saved.success ? saved.data.route : undefined
  switch (route?.type) {
    case "CourseDetails": {
      const isCourseStored =
        isReady(actionContext) && actionContext.startup.userData.getCourse(route.courseId).ok
      return isCourseStored ? { id: nextPanelId(), ...route } : undefined
    }
    case "InitializationErrorHelp":
      return initializationErrorHelpPanel(actionContext, extensionContext)
    case undefined:
      return undefined
    default:
      return assertUnreachable(route)
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
