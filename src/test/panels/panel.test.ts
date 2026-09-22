import type { Webview } from "vscode"

import { postMessageToWebview } from "../../panels/panel"
import type { ExtensionToWebview } from "../../shared/shared"
import { CourseIdentifier } from "../../shared/shared"

function fakeWebview(): { webview: Webview; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn(() => Promise.resolve(true))
  return { webview: { postMessage } as unknown as Webview, postMessage }
}

suite("postMessageToWebview", () => {
  test("posts a message that matches the contract, unchanged", async () => {
    const { webview, postMessage } = fakeWebview()
    const message: ExtensionToWebview = {
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: CourseIdentifier.from(42),
      exerciseIds: [],
    }

    expect(await postMessageToWebview(webview, message)).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(message)
  })

  test("refuses a message the receiving side would drop", async () => {
    // The webview validates against the same schema and ignores what fails, so posting
    // one anyway is a silently missing update rather than a visible error.
    const { webview, postMessage } = fakeWebview()
    const message = {
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: CourseIdentifier.from(42),
    } as unknown as ExtensionToWebview

    expect(await postMessageToWebview(webview, message)).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()
  })
})
