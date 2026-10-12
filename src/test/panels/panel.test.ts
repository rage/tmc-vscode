import type { Webview } from "vscode"

import type { ExtensionToWebview } from "../../../shared/lib"
import { postMessageToWebview } from "../../panels/panel"
import { idOfTmcCourse } from "../fixtures/identifiers"

function fakeWebview(): { webview: Webview; postMessage: ReturnType<typeof vi.fn> } {
  const postMessage = vi.fn(() => Promise.resolve(true))
  return { webview: { postMessage } as unknown as Webview, postMessage }
}

suite("postMessageToWebview", () => {
  test("posts a message that matches the contract, unchanged", async () => {
    const { webview, postMessage } = fakeWebview()
    const message: ExtensionToWebview = {
      type: "setPanel",
      panel: { id: 1, type: "CourseDetails", courseId: idOfTmcCourse(42) },
    }

    expect(await postMessageToWebview(webview, message)).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(message)
  })

  test("refuses a message the receiving side would drop", async () => {
    // The webview validates against the same schema and ignores what fails, so posting
    // one anyway is a silently missing update rather than a visible error.
    const { webview, postMessage } = fakeWebview()
    const message = {
      type: "setPanel",
      panel: { id: 1, type: "CourseDetails" },
    } as unknown as ExtensionToWebview

    expect(await postMessageToWebview(webview, message)).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()
  })
})
