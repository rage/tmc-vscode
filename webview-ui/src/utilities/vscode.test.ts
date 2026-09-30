import type { WebviewToExtension } from "../shared/shared"
import { postedMessages } from "../test/setup"
import { deepState } from "../test/state.svelte"
import { vscode } from "./vscode"

beforeEach(() => {
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

  test("keeps fields the schema does not declare", () => {
    // The host reads fields the schema cannot express (a `vscode.Uri` behind `z.custom`),
    // which zod's parse result would drop.
    const exerciseUri = { scheme: "file", path: "/exercise", fsPath: "/exercise" }
    const message = {
      type: "copyToClipboard",
      requestId: 1,
      sourcePanel: { id: 3, type: "ExerciseSubmission" },
      text: "x",
      exerciseUri,
    } as WebviewToExtension
    vscode.postMessage(message)
    expect(postedMessages).toHaveBeenCalledWith(message)
  })

  test("posts a message holding `$state` proxies as plain data", () => {
    const sourcePanel = deepState({ id: 3, type: "ExerciseSubmission" as const })
    const message: WebviewToExtension = {
      type: "copyToClipboard",
      requestId: 1,
      sourcePanel,
      text: "x",
    }
    expect(() => structuredClone(message)).toThrow()

    vscode.postMessage(message)

    expect(postedMessages).toHaveBeenCalledWith({
      type: "copyToClipboard",
      requestId: 1,
      sourcePanel: { id: 3, type: "ExerciseSubmission" },
      text: "x",
    })
  })

  test("does not log messages it posts", () => {
    const log = vi.spyOn(console, "log")
    vscode.postMessage({ type: "ready" })
    expect(log).not.toHaveBeenCalled()
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
