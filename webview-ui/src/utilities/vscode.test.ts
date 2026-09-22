import type { WebviewToExtension } from "../shared/shared"
import { postedMessages } from "../test/setup"
import { vscode } from "./vscode"

// The webview→host boundary is the last place a malformed message can be stopped: VS Code
// structured-clones every payload, so a non-serializable one (a Svelte 5 `$state` proxy, a
// whole panel where `{id, type}` is expected) fails with an opaque DataCloneError, and a
// merely wrong-shaped one reaches a host handler that cannot read it.

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

suite("the webview's postMessage", () => {
  test("posts a message the shared schema accepts", () => {
    vscode.postMessage({ type: "ready" })
    expect(postedMessages).toHaveBeenCalledWith({ type: "ready" })
  })

  test("posts the original message object, not zod's parse result", () => {
    // The parse result is a copy with everything the schema does not declare dropped,
    // and the host reads fields the schema cannot express (a `vscode.Uri` behind
    // `z.custom`), so the object posted must be the caller's own.
    const message: WebviewToExtension = {
      type: "requestMyCoursesData",
      requestId: 1,
      sourcePanel: { id: 3, type: "MyCourses", courseDeadlines: {} },
    }
    vscode.postMessage(message)
    expect(postedMessages.mock.calls[0]?.[0]).toBe(message)
  })

  test("refuses a message missing a field the host handler reads", () => {
    vscode.postMessage({ type: "requestCourseDetailsData" } as unknown as WebviewToExtension)
    expect(postedMessages).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  test("refuses a message whose type the host does not handle", () => {
    vscode.postMessage({ type: "notAMessageTheHostHandles" } as unknown as WebviewToExtension)
    expect(postedMessages).not.toHaveBeenCalled()
  })
})
