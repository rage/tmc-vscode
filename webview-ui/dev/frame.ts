import type { WebviewToExtension } from "../src/shared/shared"
import { createFakeHost } from "./fakeHost"
import type { FrameControls } from "./frameControls"
import { POSTED_EVENT } from "./frameControls"
import { findScenario } from "./scenarios"
import type { VsCodeTheme } from "./themes"
import { applyTheme, VSCODE_THEMES, WEBVIEW_DEFAULT_STYLES } from "./themes"

function findTheme(id: string | null): VsCodeTheme {
  return VSCODE_THEMES.find((theme) => theme.id === id) ?? (VSCODE_THEMES[0] as VsCodeTheme)
}

const parameters = new URLSearchParams(location.search)
const scenario = findScenario(parameters.get("scenario"))

const defaultStyles = document.createElement("style")
defaultStyles.textContent = WEBVIEW_DEFAULT_STYLES
document.head.prepend(defaultStyles)
applyTheme(document, findTheme(parameters.get("theme")), {
  isMotionReduced: parameters.get("reduceMotion") === "1",
})

const posted: WebviewToExtension[] = []
const receive = createFakeHost(scenario, async (message) => {
  window.postMessage(message, "*")
})

const controls: FrameControls = {
  posted,
  applyTheme(themeId, options) {
    applyTheme(document, findTheme(themeId), options)
  },
}
Object.assign(window, { tmcHarness: controls })

Object.assign(window, {
  acquireVsCodeApi: () => ({
    postMessage(message: WebviewToExtension) {
      posted.push(message)
      if (window.parent !== window) {
        window.parent.dispatchEvent(new CustomEvent(POSTED_EVENT, { detail: message }))
      }
      receive(message).catch((error: unknown) => {
        console.error(error)
      })
    },
    getState: () => undefined,
    setState: () => {},
  }),
})

// After the stub exists: the app calls acquireVsCodeApi while its modules load.
await import("../src/main")
