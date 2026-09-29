import type { WebviewApi } from "vscode-webview"
import { z } from "zod"

import type { WebviewToExtension } from "../shared/shared"
import { WebviewToExtensionSchema } from "../shared/shared"
import { snapshot } from "./snapshot.svelte"

/**
 * The webview's only channel to the extension host; wraps `acquireVsCodeApi()`, which may be
 * called once per page.
 *
 * Deliberately exposes no `getState`/`setState`: the extension host owns all panel state, so
 * the webview's own state bag stays empty (hence `WebviewApi<never>`).
 */
class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<never> | undefined

  public constructor() {
    if (typeof acquireVsCodeApi === "function") {
      this.vsCodeApi = acquireVsCodeApi()
    }
  }

  /**
   * Posts a message to the extension host.
   *
   * `$state` proxies anywhere in the message are unwrapped here, so callers pass state as is. A
   * message the shared schema rejects is logged and dropped.
   */
  public postMessage(message: WebviewToExtension): void {
    const plainMessage = snapshot(message)
    const validationResult = WebviewToExtensionSchema.safeParse(plainMessage)
    if (!validationResult.success) {
      console.error(
        "Refusing to post malformed message to extension host:",
        z.prettifyError(validationResult.error),
        plainMessage,
      )
      return
    }
    // Not zod's parse result, which drops fields the schema does not declare.
    if (this.vsCodeApi) {
      this.vsCodeApi.postMessage(plainMessage)
    } else {
      console.error("No vsCodeApi")
    }
  }
}

export const vscode = new VSCodeAPIWrapper()
