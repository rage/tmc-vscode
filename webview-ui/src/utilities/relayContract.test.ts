import type { WebviewToWebview } from "../shared/shared"
import { WebviewToExtensionSchema, WebviewToWebviewSchema } from "../shared/shared"
import { MOOC_INSTANCE_ID } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import { postMessageToWebview } from "./script"

// A well-formed relayed webview→webview payload. Typed as `WebviewToWebview`, so
// a reshape of the shared schema (e.g. renaming `instanceId`) turns this into a
// compile error — the build-time half of the contract guard that the old
// `message: z.unknown()` envelope lost.
const selectedMoocCourse = {
  type: "selectedMoocCourse",
  target: { id: 7, type: "MyCourses" },
  instanceId: MOOC_INSTANCE_ID,
  courseName: "MOOC Python",
} satisfies WebviewToWebview

suite("relayToWebview contract", () => {
  test("the relay envelope validates its inner message against WebviewToWebviewSchema", () => {
    const envelope = { type: "relayToWebview", message: selectedMoocCourse }
    expect(WebviewToExtensionSchema.safeParse(envelope).success).toBe(true)
    expect(WebviewToWebviewSchema.safeParse(selectedMoocCourse).success).toBe(true)
  })

  test("a reshaped relayed payload is rejected by the envelope schema", () => {
    // `instanceId` renamed to `instance_id`: previously accepted (z.unknown),
    // now the envelope fails to parse.
    const reshaped = {
      ...selectedMoocCourse,
      instanceId: undefined,
      instance_id: MOOC_INSTANCE_ID,
    }
    const envelope = { type: "relayToWebview", message: reshaped }
    expect(WebviewToExtensionSchema.safeParse(envelope).success).toBe(false)
  })

  test("postMessageToWebview relays a valid payload wrapped in the envelope", () => {
    postMessageToWebview(selectedMoocCourse)
    expect(postedMessages).toHaveBeenCalledWith({
      type: "relayToWebview",
      message: selectedMoocCourse,
    })
  })

  test("postMessageToWebview refuses to relay a malformed payload", () => {
    postedMessages.mockClear()
    // a payload the schema rejects; the webview→host boundary must drop it
    // rather than post an unvalidated message the target webview cannot handle
    postMessageToWebview({
      type: "selectedMoocCourse",
      target: { id: 7, type: "MyCourses" },
      // missing instanceId/courseName on purpose
    } as unknown as WebviewToWebview)
    expect(postedMessages).not.toHaveBeenCalled()
  })
})
