import type { WebviewApi } from "vscode-webview"
import { z } from "zod"

import type { WebviewState, WebviewToExtension } from "../shared/shared"
import { WebviewStateSchema, WebviewToExtensionSchema } from "../shared/shared"
import { snapshot } from "./snapshot.svelte"

/**
 * The webview's only channel to the extension host; wraps `acquireVsCodeApi()`, which may be
 * called once per page.
 */
class VSCodeAPIWrapper {
  private readonly vsCodeApi: WebviewApi<WebviewState> | undefined

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
   *
   * @returns whether the message was posted.
   */
  public postMessage(message: WebviewToExtension): boolean {
    const plainMessage = snapshot(message)
    const validationResult = WebviewToExtensionSchema.safeParse(plainMessage)
    if (!validationResult.success) {
      console.error(
        "Refusing to post malformed message to extension host:",
        z.prettifyError(validationResult.error),
        plainMessage,
      )
      return false
    }
    if (!this.vsCodeApi) {
      console.error("No vsCodeApi")
      return false
    }
    // Not zod's parse result, which drops fields the schema does not declare.
    this.vsCodeApi.postMessage(plainMessage)
    return true
  }

  /** What {@link setState} saved before this document loaded, if it still parses. */
  public getState(): WebviewState | undefined {
    const parsed = WebviewStateSchema.safeParse(this.vsCodeApi?.getState())
    return parsed.success ? parsed.data : undefined
  }

  /**
   * Saves UI-only state for the document VS Code reloads this panel with. The extension host
   * owns every other piece of panel state; see `uiState.svelte.ts`.
   */
  public setState(state: WebviewState): void {
    this.vsCodeApi?.setState(snapshot(state))
  }
}

export const vscode = new VSCodeAPIWrapper()
