import { vi } from "vitest"
import type * as vscode from "vscode"

/**
 * A minimal `WebviewPanel` standing in for the VS Code webview host: enough for `TmcPanel` to
 * mount and dispose, with the message listener it registers captured so a test can post to it.
 */
export function createFakeWebviewPanel(): {
  panel: vscode.WebviewPanel
  dispose: ReturnType<typeof vi.fn>
  getMessageListener: () => (message: unknown) => Promise<void>
  /** Posts the "ready" a loaded webview document sends, which is what makes `TmcPanel` render. */
  sendReady: () => Promise<void>
  /** Hides the panel, as switching to another tab does, which destroys its document. */
  hide: () => void
  /** Shows the panel again with a fresh document, which says it is ready. */
  reveal: () => Promise<void>
} {
  let listener: ((message: unknown) => Promise<void>) | undefined
  let disposeListener: (() => void) | undefined
  let viewStateListener: ((event: vscode.WebviewPanelOnDidChangeViewStateEvent) => void) | undefined
  let panelDisposed = false
  // the real host calls back into `TmcPanel.dispose()` from here, once
  const dispose = vi.fn(() => {
    if (panelDisposed) {
      return
    }
    panelDisposed = true
    disposeListener?.()
  })
  const webview = {
    html: "",
    cspSource: "self",
    // the real API resolves to whether the webview received it; `postMessageToWebview`
    // reads that to warn about undelivered messages
    postMessage: vi.fn(() => Promise.resolve(true)),
    asWebviewUri: (uri: vscode.Uri) => uri,
    onDidReceiveMessage: vi.fn((callback: (message: unknown) => Promise<void>) => {
      listener = callback
      return { dispose: vi.fn() }
    }),
  }
  const panel = {
    webview,
    visible: true,
    active: true,
    onDidDispose: vi.fn((callback: () => void) => {
      disposeListener = callback
      return { dispose: vi.fn() }
    }),
    onDidChangeViewState: vi.fn(
      (callback: (event: vscode.WebviewPanelOnDidChangeViewStateEvent) => void) => {
        viewStateListener = callback
        return { dispose: vi.fn() }
      },
    ),
    reveal: vi.fn(),
    dispose,
  }
  const getMessageListener = (): ((message: unknown) => Promise<void>) => {
    if (!listener) {
      throw new Error("webview message listener was never registered")
    }
    return listener
  }
  const setVisible = (isVisible: boolean): void => {
    panel.visible = isVisible
    panel.active = isVisible
    viewStateListener?.({ webviewPanel: panel as unknown as vscode.WebviewPanel })
  }
  const sendReady = (): Promise<void> => getMessageListener()({ type: "ready" })
  return {
    panel: panel as unknown as vscode.WebviewPanel,
    dispose,
    getMessageListener,
    sendReady,
    hide: () => setVisible(false),
    reveal: () => {
      setVisible(true)
      return sendReady()
    },
  }
}
