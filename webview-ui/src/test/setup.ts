import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/svelte"
import { afterEach, vi } from "vitest"
import { z } from "zod"

import "../elements"
import type { RequestMessage, RequestType, WebviewError, WebviewState } from "../shared/shared"
import { ExtensionToWebviewSchema } from "../shared/shared"

// The webview wrapper (src/utilities/vscode.ts) calls the global
// `acquireVsCodeApi()` in its constructor. jsdom has no such global, so stub a
// minimal in-memory implementation whose postMessage is a spy the tests read.
interface MockVsCodeApi {
  postMessage: ReturnType<typeof vi.fn>
  getState: () => unknown
  setState: (state: unknown) => void
}

// What the webview last saved with `setState`, which VS Code keeps across a document reload.
let savedState: unknown

// VS Code structured-clones every value passed to `postMessage`, so a non-cloneable one (an
// unsnapshotted `$state` proxy, a function) fails there with an opaque `DataCloneError`. Cloning
// here makes it fail in the test that posted it instead.
const vsCodeApi: MockVsCodeApi = {
  postMessage: vi.fn((message: unknown) => {
    structuredClone(message)
  }),
  getState: () => savedState,
  setState: (state: unknown) => {
    savedState = structuredClone(state)
  },
}

;(globalThis as unknown as { acquireVsCodeApi: () => MockVsCodeApi }).acquireVsCodeApi = () =>
  vsCodeApi

// Not a static import, which would be hoisted above the stub and call `acquireVsCodeApi()` first.
const { leaveScreen } = await import("../utilities/uiState.svelte")

// Svelte 5 transitions drive their timing through `element.animate`, which jsdom does not
// implement; stub it so components using `transition:*` render instead of throwing.
const animateStub = (): Animation => {
  const animation = {
    currentTime: 0,
    startTime: 0,
    playState: "finished",
    finished: Promise.resolve(),
    onfinish: null as (() => void) | null,
    oncancel: null as (() => void) | null,
    play() {},
    pause() {},
    finish() {},
    cancel() {},
    reverse() {},
    addEventListener() {},
    removeEventListener() {},
  }
  // let Svelte's onfinish handler run so intro/outro transitions settle
  queueMicrotask(() => animation.onfinish?.())
  return animation as unknown as Animation
}
if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = animateStub
}

// jsdom's ElementInternals omits the form-associated methods, which `@vscode-elements`
// form controls call on every update. The resulting TypeError escapes as a global
// `error` event, so App renders its crash view instead of the panel under test.
if (
  typeof ElementInternals !== "undefined" &&
  typeof ElementInternals.prototype.setFormValue !== "function"
) {
  ElementInternals.prototype.setFormValue = () => {}
  ElementInternals.prototype.setValidity = () => {}
}

// `svelte/motion` queries `prefers-reduced-motion` as soon as it is imported.
window.matchMedia ??= (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList

// `<vscode-icon>` warns when the codicons stylesheet is missing, passing the element
// itself as `%o`. Node's inspect of that element reaches `document.styleSheets`, whose
// jsdom `href` getter throws on a non-branded receiver; the throw escapes as a global
// `error` event, so App renders its crash view instead of the panel under test. The
// stylesheet only has to exist -- nothing here asserts on glyphs.
if (typeof document !== "undefined" && !document.querySelector("#vscode-codicon-stylesheet")) {
  const codicons = document.createElement("link")
  codicons.id = "vscode-codicon-stylesheet"
  codicons.rel = "stylesheet"
  codicons.href = "codicon.css"
  document.head.append(codicons)
}

/** The messages the component under test has posted back to the extension host. */
export const postedMessages = vsCodeApi.postMessage

/**
 * Delivers a message to the component under test the way the extension host does.
 *
 * Both halves of the real boundary are enforced here: the message is checked against
 * `ExtensionToWebviewSchema`, which the webview listener also applies and silently drops
 * what fails, and it is `structuredClone`d, which is what VS Code does to it. A fixture
 * that has drifted from the contract therefore fails in the test that sent it rather than
 * quietly delivering nothing.
 */
export function dispatchToWebview(message: unknown): void {
  const validationResult = ExtensionToWebviewSchema.safeParse(message)
  if (!validationResult.success) {
    throw new Error(
      `Message does not match ExtensionToWebviewSchema: ${z.prettifyError(validationResult.error)}`,
    )
  }
  window.dispatchEvent(new MessageEvent("message", { data: structuredClone(message) }))
}

/**
 * Answers the latest `type` request the component under test posted, the way the host does.
 *
 * @param requestId answers that request instead, e.g. one the component no longer waits on.
 */
export function replyToRequest(
  type: RequestType,
  outcome: { ok: true; value?: unknown } | { ok: false; error: WebviewError },
  requestId?: number,
): void {
  const request = postedMessages.mock.calls
    .map(([message]) => message as RequestMessage)
    .filter((message) => message.type === type)
    .at(-1)
  if (!request) {
    throw new Error(`No "${type}" request was posted`)
  }
  dispatchToWebview({
    type: "reply",
    target: { id: request.sourcePanel.id, type: request.sourcePanel.type },
    requestId: requestId ?? request.requestId,
    outcome,
  })
}

/** What the webview has saved with `setState`, as VS Code would hand it to a reloaded document. */
export function savedWebviewState(): WebviewState | undefined {
  return savedState as WebviewState | undefined
}

/**
 * Unmounts everything and starts the next render as a document VS Code reloaded a hidden panel
 * with: the saved state stays, everything else is gone.
 */
export function reloadDocument(): void {
  cleanup()
  leaveScreen()
}

afterEach(() => {
  cleanup()
  leaveScreen()
  savedState = undefined
  vsCodeApi.postMessage.mockClear()
})
