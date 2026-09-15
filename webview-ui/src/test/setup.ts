import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/svelte"
import { afterEach, vi } from "vitest"

// The webview wrapper (src/utilities/vscode.ts) calls the global
// `acquireVsCodeApi()` in its constructor. jsdom has no such global, so stub a
// minimal in-memory implementation whose postMessage is a spy the tests read.
interface MockVsCodeApi {
  postMessage: ReturnType<typeof vi.fn>
}

// DataCloneError regression guard: VS Code structured-clones every value passed
// to `postMessage`, so a non-cloneable one (a Svelte 5 `$state` proxy that wasn't
// `$state.snapshot`-ed, a function, a class instance) crashes the real
// webview<->host boundary with an opaque `DataCloneError`. Running the same
// `structuredClone` in the mock makes such a payload fail inside the test that
// posted it instead of only in production. The clone result is discarded; the spy
// still records the original message for shape assertions.
const cloneGuard =
  typeof structuredClone === "function"
    ? structuredClone
    : // extremely defensive fallback for a jsdom build without structuredClone;
      // JSON round-trip rejects functions/undefined-valued cycles similarly enough
      (value: unknown): unknown => JSON.parse(JSON.stringify(value))

const vsCodeApi: MockVsCodeApi = {
  postMessage: vi.fn((message: unknown) => {
    cloneGuard(message)
  }),
}

;(globalThis as unknown as { acquireVsCodeApi: () => MockVsCodeApi }).acquireVsCodeApi = () =>
  vsCodeApi

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

afterEach(() => {
  cleanup()
  vsCodeApi.postMessage.mockClear()
})
