import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/svelte"
import { afterEach, vi } from "vitest"

// The webview wrapper (src/utilities/vscode.ts) calls the global
// `acquireVsCodeApi()` in its constructor. jsdom has no such global, so stub a
// minimal in-memory implementation whose postMessage is a spy the tests read.
interface MockVsCodeApi {
  postMessage: ReturnType<typeof vi.fn>
  getState: ReturnType<typeof vi.fn>
  setState: ReturnType<typeof vi.fn>
}

// DataCloneError regression guard: VS Code serializes every posted message with
// the structured clone algorithm, so a non-cloneable value (a Svelte 5 `$state`
// proxy that wasn't `$state.snapshot`-ed, a function, a class instance) crashes
// the real webview↔host boundary with an opaque `DataCloneError`. Running the
// same `structuredClone` in the mock's `postMessage` makes such a payload fail
// loudly inside the test that posted it, right where the assertions are, rather
// than only in production. The clone result is discarded; the spy still records
// the original message for shape assertions.
//
// Both `postMessage` and `setState` are DataCloneError boundaries: VS Code
// structured-clones each argument, so a `$state` proxy that wasn't snapshotted
// crashes them alike. `savePanelState` snapshots before `setState`, so the guard
// mirrors the contract the code upholds on both channels.
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
  getState: vi.fn(() => undefined),
  setState: vi.fn((state: unknown) => {
    cloneGuard(state)
    return state
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

/** The messages the component under test has posted back to the extension host. */
export const postedMessages = vsCodeApi.postMessage

/** The persisted-state writes the component under test has made via `setState`. */
export const savedStates = vsCodeApi.setState

afterEach(() => {
  cleanup()
  vsCodeApi.postMessage.mockClear()
  vsCodeApi.getState.mockClear()
  vsCodeApi.setState.mockClear()
})
