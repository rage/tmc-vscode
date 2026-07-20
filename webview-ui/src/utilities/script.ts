import type { Writable } from "svelte/store"
import { writable } from "svelte/store"
import { z } from "zod"

/**
 * Various utility functions and types for Svelte <script>s
 */
import type { ExtensionToWebview, Panel, Targeted, WebviewToExtension } from "../shared/shared"
import { ExtensionToWebviewSchema, targetPanelSchema } from "../shared/shared"
import { vscode } from "./vscode"

/**
 * Message from the extension host or a webview.
 */
type Message = ExtensionToWebview | WebviewToWebview

/**
 * Message from webview to webview.
 */
const WebviewToWebviewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("selectedOrganization"),
    target: targetPanelSchema("MyCourses"),
    slug: z.string(),
  }),
  z.object({
    type: z.literal("selectedCourse"),
    target: targetPanelSchema("MyCourses"),
    organizationSlug: z.string(),
    courseId: z.number(),
  }),
  z.object({
    type: z.literal("selectedMoocCourse"),
    target: targetPanelSchema("MyCourses"),
    organizationSlug: z.string(),
    courseId: z.string(),
    instanceId: z.string(),
    courseName: z.string(),
    instanceName: z.string().nullable(),
  }),
])

type WebviewToWebview =
  | z.infer<typeof WebviewToWebviewSchema>
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
 * Convenience function for writable Svelte stores with an `undefined` starting value. The actual value is "loaded" later.
 */
export function loadable<T>(): Writable<T | undefined> {
  return writable(undefined)
}

/**
 * Convenience function for listening to messages from the extension host to the webview.
 */
export function addMessageListener<T extends Panel>(
  listeningPanel: T,
  callback: (message: TargetedMessage<T>) => void,
): void {
  window.addEventListener("message", (event) => {
    const validationResult = MessageToWebviewSchema.safeParse(event.data)
    if (!validationResult.success) {
      // log and drop invalid messages instead of crashing the webview
      console.warn(
        "Ignoring invalid message to webview:",
        z.prettifyError(validationResult.error),
        event.data,
      )
      return
    }
    // note: the original data is passed on rather than the parse result on purpose,
    // as zod strips unknown fields by default and the validation is only meant to
    // act as a guard
    const message = event.data as Message
    // if no target id is given, accept all messages
    // if a target id is given, only accept messages with the correct id
    const correctType = message.target.type === listeningPanel.type
    if (correctType && (!("id" in message.target) || message.target.id === listeningPanel.id)) {
      callback(message as TargetedMessage<T>)
    }
  })
}

/**
 * Posts a message to another webview.
 */
export function postMessageToWebview(message: WebviewToWebview): void {
  // relay the message through the extension host
  const webviewToExtension: WebviewToExtension = {
    type: "relayToWebview",
    message,
  }
  vscode.postMessage(webviewToExtension)
}

export function savePanelState(panel: Panel): void {
  vscode.setState({ panel })
}
