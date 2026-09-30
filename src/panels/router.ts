import type { Result } from "ts-results"
import type * as vscode from "vscode"
import { z } from "zod"

import type { ActionContext, ReadyActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import { InitializationError } from "../errors"
import type {
  ExtensionToWebview,
  ReplyOutcome,
  ReplyValue,
  Panel,
  RequestMessage,
  RequestType,
  WebviewToExtension,
} from "../shared/shared"
import { toWebviewError, WebviewToExtensionSchema } from "../shared/shared"
import { Logger } from "../utilities"

/** One webview's side of the panel manager, as the message handlers see it. */
export interface PanelHost {
  /** Tells the main webview from the side one, in log lines. */
  readonly name: string
  /** The screen this webview shows, if any. */
  readonly route: Panel | undefined
  /** Sends `message` to this webview alone, kept for a reload if it targets `route`. */
  post: (message: ExtensionToWebview) => void
  /** {@link post} without keeping it: for messages a reloaded webview must not see again. */
  postTransient: (message: ExtensionToWebview) => void
  /** Shows `route` in this webview. */
  render: (route: Panel) => void
  /** Shows `route` in the main panel, creating it if needed. */
  renderMain: (route: Panel) => void
  closeSidePanel: () => void
}

/** What a message handler acts through. */
export interface HandlerContext<C extends ActionContext = ActionContext> {
  host: PanelHost
  actionContext: C
  extensionContext: vscode.ExtensionContext
}

/** The type of a webview-to-host message. */
export type MessageType = WebviewToExtension["type"]

type MessageOf<K extends MessageType> = Extract<WebviewToExtension, { type: K }>

/** A request handler resolves to its reply; any other handler to nothing. */
type HandlerOutcome<K extends MessageType> = K extends RequestType
  ? Result<ReplyValue<K>, unknown>
  : void

type Handle<K extends MessageType, C extends ActionContext> = (
  message: MessageOf<K>,
  context: HandlerContext<C>,
) => Promise<HandlerOutcome<K>> | HandlerOutcome<K>

/**
 * Handles one webview message type.
 *
 * A `requiresReady` handler runs only after a successful activation, and gets the narrowed
 * context; otherwise {@link dispatch} answers for it.
 */
export type Handler<K extends MessageType> =
  | { requiresReady: true; handle: Handle<K, ReadyActionContext> }
  | { requiresReady: false; handle: Handle<K, ActionContext> }

/** One handler per message type, so a message type without one does not compile. */
export type HandlerMap = { [K in MessageType]: Handler<K> }

/**
 * Validates one message from a webview and runs its handler.
 *
 * Every request gets exactly one reply: a not-ready or failed one inline, since its panel is
 * waiting and shows why. A fire-and-forget message that cannot run is notified instead, as
 * nothing on screen would say so. A throw is also notified: it is a bug, not an outcome.
 * Never rejects: the webview host discards whatever a listener rejects with.
 */
export async function dispatch(
  handlers: HandlerMap,
  untrustedMessage: unknown,
  context: HandlerContext,
): Promise<void> {
  const validationResult = WebviewToExtensionSchema.safeParse(untrustedMessage)
  if (!validationResult.success) {
    Logger.error("Ignoring invalid message from webview:", z.prettifyError(validationResult.error))
    return
  }
  // zod strips unknown fields, so the original message is used instead of the parse result
  const message = untrustedMessage as WebviewToExtension
  const request = "requestId" in message ? message : undefined
  const { actionContext } = context
  const handler = handlers[message.type] as Handler<MessageType>
  try {
    if (handler.requiresReady && !isReady(actionContext)) {
      const error = new InitializationError("The extension did not initialize properly")
      if (request) {
        Logger.error("This action is unavailable.", error)
        reply(context.host, request, { ok: false, error: toWebviewError(error) })
      } else {
        void actionContext.dialog.reportError("This action is unavailable.", error)
      }
      return
    }
    const outcome = await (handler.handle as Handle<MessageType, ActionContext>)(message, context)
    if (request) {
      const result = outcome as Result<unknown, unknown>
      reply(
        context.host,
        request,
        result.ok
          ? { ok: true, value: result.val }
          : { ok: false, error: toWebviewError(result.val) },
      )
    }
  } catch (error) {
    Logger.error(`Failed to handle "${message.type}" from the webview`, error)
    void actionContext.dialog.reportError(
      "Something went wrong while handling that action.",
      error instanceof Error ? error : new Error(String(error)),
    )
    if (request) {
      reply(context.host, request, { ok: false, error: toWebviewError(error) })
    }
  }
}

function reply(
  host: PanelHost,
  request: RequestMessage,
  outcome: ReplyOutcome<RequestType> | { ok: true; value: unknown },
): void {
  host.post({
    type: "reply",
    target: { id: request.sourcePanel.id, type: request.sourcePanel.type },
    requestId: request.requestId,
    outcome,
  })
}
