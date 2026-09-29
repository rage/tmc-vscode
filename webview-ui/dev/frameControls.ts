import type { WebviewToExtension } from "../src/shared/shared"

/** What the harness page and the accessibility tests reach into the webview frame through. */
export interface FrameControls {
  /** Every message the webview has posted to the host, oldest first. */
  posted: WebviewToExtension[]
  applyTheme: (themeId: string, options: { isMotionReduced: boolean }) => void
}

/** Fired on the parent window for each message the webview posts, with the message as `detail`. */
export const POSTED_EVENT = "tmc-harness-posted"
