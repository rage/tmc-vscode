import { onDestroy } from "svelte"
import { z } from "zod"

/**
 * Various utility functions and types for Svelte <script>s
 */
import type { ExtensionToWebview, Panel, Targeted } from "../shared/shared"
import { ExtensionToWebviewSchema } from "../shared/shared"

type TargetedMessage<T extends Panel> = Targeted<ExtensionToWebview, T["type"]>

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
    const validationResult = ExtensionToWebviewSchema.safeParse(event.data)
    if (!validationResult.success) {
      console.warn(
        "Ignoring invalid message to webview:",
        z.prettifyError(validationResult.error),
        event.data,
      )
      return
    }
    // zod strips unknown fields, so the original data is used instead of the parse result
    const message = event.data as ExtensionToWebview
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
