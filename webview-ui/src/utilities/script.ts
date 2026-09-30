import { onDestroy } from "svelte"
import { z } from "zod"

import type {
  ExtensionToWebview,
  Panel,
  ReplyOutcome,
  RequestMessage,
  RequestType,
  Targeted,
  WebviewError,
} from "../shared/shared"
import { ExtensionToWebviewSchema, ReplyValueSchemas } from "../shared/shared"
import { vscode } from "./vscode"

type ReplyMessage = Extract<ExtensionToWebview, { type: "reply" }>

type SetPanelMessage = Extract<ExtensionToWebview, { type: "setPanel" }>

/**
 * A message a panel listens for; replies go to the request that is awaiting them instead, and
 * `setPanel` to the app.
 */
type PanelMessage = Exclude<ExtensionToWebview, ReplyMessage | SetPanelMessage>

type TargetedMessage<T extends Panel> = Targeted<PanelMessage, T["type"]>

type MessageListener = (message: PanelMessage) => void

const messageListeners = new Set<MessageListener>()

let panelListener: ((panel: Panel) => void) | undefined

/** Settles one outstanding request, keyed by its `requestId`. */
const pendingRequests = new Map<number, (reply: ReplyMessage) => void>()

// One window listener for the whole app, so each message is handled once however many
// components listen.
function dispatchMessage(event: MessageEvent): void {
  // The host validates every message it posts against the same schema, so checking again
  // here only guards this side of the contract while it is being developed.
  if (import.meta.env.DEV) {
    const validationResult = ExtensionToWebviewSchema.safeParse(event.data)
    if (!validationResult.success) {
      console.warn(
        "Ignoring invalid message to webview:",
        z.prettifyError(validationResult.error),
        event.data,
      )
      return
    }
  }
  // zod strips unknown fields, so the original data is used instead of the parse result
  const message = event.data as ExtensionToWebview
  if (message.type === "reply") {
    pendingRequests.get(message.requestId)?.(message)
    return
  }
  if (message.type === "setPanel") {
    panelListener?.(message.panel)
    return
  }
  // A listener added while this message is dispatched (a panel it mounted) waits for the next
  // one; a listener removed meanwhile gets nothing.
  for (const listener of Array.from(messageListeners)) {
    if (messageListeners.has(listener)) {
      listener(message)
    }
  }
}
window.addEventListener("message", dispatchMessage)

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
  const listener: MessageListener = (message) => {
    // a target without an id is a broadcast to every panel of its type
    const correctType = message.target.type === listeningPanel.type
    if (correctType && (!("id" in message.target) || message.target.id === listeningPanel.id)) {
      callback(message as TargetedMessage<T>)
    }
  }
  messageListeners.add(listener)
  const dispose = (): void => {
    messageListeners.delete(listener)
  }
  onDestroy(dispose)
  return dispose
}

/**
 * Receives each panel the host sets, for the one component that renders it.
 *
 * Must be called during component initialization; replaces any earlier listener.
 */
export function onSetPanel(callback: (panel: Panel) => void): void {
  panelListener = callback
  onDestroy(() => {
    if (panelListener === callback) {
      panelListener = undefined
    }
  })
}

/**
 * The timeout for a request the host answers from state it already holds, with no network
 * round trip: only a crashed host or a dropped message outlasts it.
 */
export const HOST_STATE_TIMEOUT_MS = 30_000

const TIMED_OUT: WebviewError = { message: "The extension did not answer in time." }

const NOT_POSTED: WebviewError = { message: "The request could not be sent to the extension." }

type RequestFields<K extends RequestType> = Omit<
  Extract<RequestMessage, { type: K }>,
  "type" | "requestId"
>

export interface RequestOptions {
  /**
   * Gives up on the reply after this long. Omit it for requests that wait on the network or
   * the user, which the host always answers once they end.
   */
  timeoutMs?: number
}

/**
 * Posts one request to the extension host and resolves to its reply.
 *
 * Never rejects. Destroying the component that made the request abandons it: the promise
 * stays pending, so nothing runs against a panel that is gone.
 */
export type Request = <K extends RequestType>(
  type: K,
  fields: RequestFields<K>,
  options?: RequestOptions,
) => Promise<ReplyOutcome<K>>

// Starts at random so a reloaded page, whose counter restarts, does not reuse the id of a
// request the host is still working on for the page it replaced.
let nextRequestId = Math.floor(Math.random() * 2 ** 30) + 1

/**
 * Creates the {@link Request} function a component makes its requests with.
 *
 * Must be called during component initialization, like other Svelte lifecycle functions.
 */
export function createRequester(): Request {
  const ownRequests = new Map<number, ReturnType<typeof setTimeout> | undefined>()

  const forget = (requestId: number): void => {
    clearTimeout(ownRequests.get(requestId))
    ownRequests.delete(requestId)
    pendingRequests.delete(requestId)
  }

  onDestroy(() => {
    for (const requestId of Array.from(ownRequests.keys())) {
      forget(requestId)
    }
  })

  return <K extends RequestType>(
    type: K,
    fields: RequestFields<K>,
    options: RequestOptions = {},
  ): Promise<ReplyOutcome<K>> => {
    const requestId = nextRequestId++
    return new Promise((resolve) => {
      const settle = (outcome: ReplyOutcome<K>): void => {
        forget(requestId)
        resolve(outcome)
      }
      pendingRequests.set(requestId, ({ outcome }) => {
        if (outcome.ok && import.meta.env.DEV) {
          const valueResult = ReplyValueSchemas[type].safeParse(outcome.value)
          if (!valueResult.success) {
            console.warn(`Invalid "${type}" reply:`, z.prettifyError(valueResult.error))
          }
        }
        settle(outcome as ReplyOutcome<K>)
      })
      ownRequests.set(
        requestId,
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => settle({ ok: false, error: TIMED_OUT }), options.timeoutMs),
      )
      if (!vscode.postMessage({ type, requestId, ...fields } as RequestMessage)) {
        settle({ ok: false, error: NOT_POSTED })
      }
    })
  }
}
