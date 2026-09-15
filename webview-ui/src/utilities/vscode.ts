import type { WebviewApi } from "vscode-webview"
import { z } from "zod"

import type { WebviewToExtension } from "../shared/shared"
import { WebviewToExtensionSchema } from "../shared/shared"

/**
 * A utility wrapper around the acquireVsCodeApi() function, which enables
 * message passing and state management between the webview and extension
 * contexts.
 *
 * This utility also enables webview code to be run in a web browser-based
 * dev server by using native web browser features that mock the functionality
 * enabled by acquireVsCodeApi.
 */
class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<unknown> | undefined

  public constructor() {
    // Check if the acquireVsCodeApi function exists in the current development
    // context (i.e. VS Code development window or web browser)
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi()
    }
  }

  /**
   * Post a message (i.e. send arbitrary data) to the owner of the webview.
   *
   * @remarks When running webview code inside a web browser, postMessage will instead
   * log the given message to the console.
   *
   * @param message Abitrary data (must be JSON serializable) to send to the extension context.
   */
  public postMessage(message: WebviewToExtension): void {
    console.log("Message from webview", message)
    // guards against posting a non-serializable value (e.g. a Svelte 5 `$state` proxy, or a
    // whole panel where only `{id, type}` is expected), which would otherwise fail with an
    // opaque DataCloneError. On success the original message is still sent, since zod would
    // strip fields the receiver relies on (e.g. `z.custom<Uri>()`).
    const validationResult = WebviewToExtensionSchema.safeParse(message)
    if (!validationResult.success) {
      console.error(
        "Refusing to post malformed message to extension host:",
        z.prettifyError(validationResult.error),
        message,
      )
      return
    }
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(message)
    } else {
      console.error("No vsCodeApi")
    }
  }
}

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscode = new VSCodeAPIWrapper()
