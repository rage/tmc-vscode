import { onDestroy } from "svelte"
import { z } from "zod"

/**
 * Various utility functions and types for Svelte <script>s
 */
import type { ExtensionToWebview, Panel, Targeted, WebviewError } from "../shared/shared"
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

/**
 * How long a panel waits for the extension host to answer a data request.
 *
 * The host answers from state it already holds, with no network round trip, so this only
 * has to outlast a busy extension host getting around to the message. It is the last
 * resort against an answer that never comes at all -- a crashed host, a dropped message,
 * a handler that returns without sending one.
 */
const PANEL_DATA_TIMEOUT_MS = 30_000

const PANEL_DATA_TIMED_OUT: WebviewError = {
  message: "The extension did not answer in time.",
}

/** The host's answer to one `request*Data` message. */
interface PanelDataAnswer {
  requestId: number
  error?: WebviewError | undefined
}

export interface PanelDataRequester {
  /**
   * Asks the extension host for the data a panel renders, and waits for its answer.
   *
   * @param post receives the id identifying this request. The message it posts must carry
   *   that id as `requestId`, or the host's answer cannot be matched back to it.
   * @returns why the data could not be assembled, or `undefined` once the host reports
   *   having sent it. A host that never answers yields a timeout rather than a promise
   *   that stays pending and a panel that waits forever.
   */
  request: (post: (requestId: number) => void) => Promise<WebviewError | undefined>

  /** Hands an answer to the request it belongs to. An answer to any other is ignored. */
  answer: (answer: PanelDataAnswer) => void
}

let nextRequestId = 1

/**
 * Correlates one panel's data requests with the extension host's answers.
 *
 * Must be called during component initialization, like other Svelte lifecycle functions:
 * outstanding requests are abandoned and their timers cleared when the component is
 * destroyed, so a panel recreated by `{#key}` leaves nothing running.
 */
export function createPanelDataRequester(): PanelDataRequester {
  const pending = new Map<
    number,
    { timer: ReturnType<typeof setTimeout>; resolve: (error: WebviewError | undefined) => void }
  >()

  onDestroy(() => {
    for (const { timer } of pending.values()) {
      clearTimeout(timer)
    }
    pending.clear()
  })

  const settle = (requestId: number, error: WebviewError | undefined): void => {
    const request = pending.get(requestId)
    if (request === undefined) {
      return
    }
    clearTimeout(request.timer)
    pending.delete(requestId)
    request.resolve(error)
  }

  return {
    request(post) {
      const requestId = nextRequestId++
      return new Promise((resolve) => {
        pending.set(requestId, {
          timer: setTimeout(() => settle(requestId, PANEL_DATA_TIMED_OUT), PANEL_DATA_TIMEOUT_MS),
          resolve,
        })
        post(requestId)
      })
    },
    answer({ requestId, error }) {
      settle(requestId, error)
    },
  }
}
