import { onDestroy } from "svelte"
import { z } from "zod"

/**
 * Various utility functions and types for Svelte <script>s
 */
import type {
  ExtensionToWebview,
  Panel,
  Targeted,
  WebviewToExtension,
  WebviewToWebview as SharedWebviewToWebview,
} from "../shared/shared"
import { ExtensionToWebviewSchema, WebviewToWebviewSchema } from "../shared/shared"
import { vscode } from "./vscode"

/**
 * Message from the extension host or a webview.
 */
type Message = ExtensionToWebview | WebviewToWebview

/**
 * Message from webview to webview.
 *
 * The relayable set is defined once in `shared/shared` (`WebviewToWebviewSchema`)
 * so the `relayToWebview` envelope can validate it on both sides of the boundary.
 */
type WebviewToWebview =
  | SharedWebviewToWebview
  // the last variant exists just to make TypeScript think that every panel type has
  // at least two different message types, which makes TS treat them differently than if
  // they only had one...
  | {
      type: never
      target: never
    }

/**
 * Schema for any message that may arrive at the webview
 * (from the extension host, or relayed from another webview).
 */
const MessageToWebviewSchema = z.union([ExtensionToWebviewSchema, WebviewToWebviewSchema])

type TargetedMessage<T extends Panel> = Targeted<Message, T["type"]>

/**
 * Convenience function for listening to messages from the extension host to the webview.
 *
 * Removes the listener automatically via `onDestroy` when the component is destroyed, so
 * components recreated on navigation (e.g. via `{#key}`) don't accumulate stale listeners.
 * Must be called synchronously during component initialization, like other Svelte lifecycle
 * functions.
 *
 * @returns A disposer to remove the listener early; most callers can ignore it.
 */
export function addMessageListener<T extends Panel>(
  listeningPanel: T,
  callback: (message: TargetedMessage<T>) => void,
): () => void {
  const handleMessage = (event: MessageEvent): void => {
    const validationResult = MessageToWebviewSchema.safeParse(event.data)
    if (!validationResult.success) {
      console.warn(
        "Ignoring invalid message to webview:",
        z.prettifyError(validationResult.error),
        event.data,
      )
      return
    }
    // zod strips unknown fields, so the original data is used instead of the parse result
    const message = event.data as Message
    // if no target id is given, accept all messages
    // if a target id is given, only accept messages with the correct id
    const correctType = message.target.type === listeningPanel.type
    if (correctType && (!("id" in message.target) || message.target.id === listeningPanel.id)) {
      callback(message as TargetedMessage<T>)
    }
  }
  window.addEventListener("message", handleMessage)
  const dispose = (): void => window.removeEventListener("message", handleMessage)
  onDestroy(dispose)
  return dispose
}

/**
 * Posts a message to another webview.
 */
export function postMessageToWebview(message: SharedWebviewToWebview): void {
  // relay the message through the extension host
  const webviewToExtension: WebviewToExtension = {
    type: "relayToWebview",
    message,
  }
  vscode.postMessage(webviewToExtension)
}

/** Builds the URL for a logo served by the backend, falling back to its "missing" placeholder. */
export function resolveLogoPath(backendUrl: string, path: string): string {
  return !path.endsWith("missing.png")
    ? `${backendUrl}${path}`
    : `${backendUrl}/logos/small_logo/missing.png`
}

export function savePanelState(panel: Panel): void {
  // `panel` reaches here as a Svelte 5 `$state` proxy (it is the reassigned panel
  // prop). VS Code's real `setState` serializes its argument with the structured
  // clone algorithm, which throws `DataCloneError` on a proxy -- the same hazard
  // the postMessage boundary guards against. Deep-clone to a plain object first.
  // This is a plain `.ts` module, so `$state.snapshot` (a compiler rune) is not
  // available; a JSON round-trip reads through the proxy and yields a plain,
  // structured-cloneable object (Panel is always JSON-serializable).
  vscode.setState({ panel: JSON.parse(JSON.stringify(panel)) as Panel })
}
