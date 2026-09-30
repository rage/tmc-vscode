import { z } from "zod"

import type { ExtensionToWebview, WebviewToExtension } from "../src/shared/shared"
import { ExtensionToWebviewSchema } from "../src/shared/shared"
import type { Scenario } from "./scenarios"

/**
 * Plays the extension host for `scenario`: answers each message the webview posts by handing the
 * replies, in order, to `deliver`.
 *
 * Replies are validated first, because the webview drops a message that fails its schema without
 * a trace, which would leave a drifted scenario looking like a panel bug.
 */
export function createFakeHost(
  scenario: Scenario,
  deliver: (message: ExtensionToWebview) => Promise<void>,
): (message: WebviewToExtension) => Promise<void> {
  return async (message) => {
    const replies: ExtensionToWebview[] =
      message.type === "ready"
        ? [{ type: "setPanel", panel: scenario.panel }, ...(scenario.pushes ?? [])]
        : (scenario.reply?.(message) ?? [])
    for (const reply of replies) {
      const validation = ExtensionToWebviewSchema.safeParse(reply)
      if (!validation.success) {
        throw new Error(
          `Scenario ${scenario.id} sent an invalid ${reply.type}: ${z.prettifyError(validation.error)}`,
        )
      }
      await deliver(structuredClone(reply))
    }
  }
}
