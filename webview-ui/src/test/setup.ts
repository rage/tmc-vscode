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
// Scoped to `postMessage` deliberately: the extension code treats that channel
// as the DataCloneError boundary (it `$state.snapshot`s before every
// `postMessage`, e.g. in CourseDetails), so the guard mirrors the contract the
// code actually upholds. `setState` is left unguarded.
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
  setState: vi.fn((state: unknown) => state),
}

;(globalThis as unknown as { acquireVsCodeApi: () => MockVsCodeApi }).acquireVsCodeApi = () =>
  vsCodeApi

/** The messages the component under test has posted back to the extension host. */
export const postedMessages = vsCodeApi.postMessage

afterEach(() => {
  cleanup()
  vsCodeApi.postMessage.mockClear()
  vsCodeApi.getState.mockClear()
  vsCodeApi.setState.mockClear()
})
