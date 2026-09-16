import type { Webview } from "vscode"
import { z } from "zod"

import { DEBUG_MODE } from "../config/constants"
import type { ExtensionToWebview, Panel } from "../shared/shared"
import { ExtensionToWebviewSchema } from "../shared/shared"
import { Logger, LogLevel } from "./logger"

/**
 * Helper function for the extension panel to render a webview panel.
 */
export async function renderPanel(panel: Panel, webview: Webview): Promise<void> {
  const sent = postMessageToWebview(webview, {
    type: "setPanel",
    target: { id: 0, type: "App" },
    panel,
  })
  sent.then((delivered) => {
    if (delivered) {
      Logger.debug(`Webview panel set to "${panel.type}"`)
    }
  })
}

// don't await this; the returned Thenable only reports whether delivery succeeded
export function postMessageToWebview(
  webview: Webview,
  message: ExtensionToWebview,
  context = "webview",
): Thenable<boolean> {
  // The receiving side validates against the same schema and drops what fails, so a
  // message that does not match it is a bug here and never reaches the panel anyway.
  const validationResult = ExtensionToWebviewSchema.safeParse(message)
  if (!validationResult.success) {
    Logger.error(
      `Refusing to post an invalid message to ${context}:`,
      z.prettifyError(validationResult.error),
    )
    return Promise.resolve(false)
  }
  Logger.debug(`Posting a message to ${context}: "${message.type}"`)
  // Logger.debug evaluates its args eagerly, so an ungated stringify would run at every level
  if (DEBUG_MODE || Logger.level === LogLevel.Verbose) {
    Logger.debug("Message contents", JSON.stringify(message, null, 2))
  }
  // zod strips unknown fields, so the original message is posted instead of the parse result
  const sent = webview.postMessage(message)
  sent.then((delivered) => {
    if (!delivered) {
      Logger.warn(`${context} did not receive message of type "${message.type}"`)
    }
  })
  return sent
}
