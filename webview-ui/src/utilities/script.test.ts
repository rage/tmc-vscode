import { render } from "@testing-library/svelte"

import { makeTmcKind } from "../shared/shared"
import { tmcLocalCourse } from "../test/fixtures"
import MessageListenerProbe from "../test/MessageListenerProbe.svelte"
import RequesterProbe from "../test/RequesterProbe.svelte"
import { dispatchToWebview, postedMessages, replyToRequest } from "../test/setup"
import type { Request } from "./script"

const courseDetails = {
  id: 5,
  type: "CourseDetails" as const,
  courseId: makeTmcKind({ courseId: 42 }),
}
const setCourseData = {
  type: "setCourseData",
  target: { id: 5, type: "CourseDetails" },
  courseData: tmcLocalCourse(),
} as const

afterEach(() => {
  vi.restoreAllMocks()
})

suite("addMessageListener", () => {
  test("delivers a message only to listeners of its target panel", () => {
    const listening = vi.fn()
    const other = vi.fn()
    render(MessageListenerProbe, { props: { panel: courseDetails, onmessage: listening } })
    render(MessageListenerProbe, {
      props: { panel: { ...courseDetails, id: 6 }, onmessage: other },
    })

    dispatchToWebview(setCourseData)

    expect(listening).toHaveBeenCalledWith(setCourseData)
    expect(other).not.toHaveBeenCalled()
  })

  test("validates an invalid message once however many components listen", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const listener = vi.fn()
    render(MessageListenerProbe, { props: { panel: courseDetails, onmessage: listener } })
    render(MessageListenerProbe, { props: { panel: courseDetails, onmessage: listener } })

    window.dispatchEvent(new MessageEvent("message", { data: { type: "notAMessage" } }))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
  })

  test("stops delivering once the listening component is destroyed", () => {
    const listener = vi.fn()
    const { unmount } = render(MessageListenerProbe, {
      props: { panel: courseDetails, onmessage: listener },
    })
    unmount()

    dispatchToWebview(setCourseData)

    expect(listener).not.toHaveBeenCalled()
  })
})

/** Mounts a component and returns the requester it created. */
function mountRequester(): { request: Request; unmount: () => void } {
  let request: Request | undefined
  const { unmount } = render(RequesterProbe, {
    props: {
      onready: (created: Request) => {
        request = created
      },
    },
  })
  if (!request) {
    throw new Error("the probe never handed over its requester")
  }
  return { request, unmount }
}

suite("createRequester", () => {
  const sourcePanel = courseDetails

  test("resolves to the reply naming its request", async () => {
    const { request } = mountRequester()

    const outcome = request("requestCourseDetailsData", { sourcePanel })
    replyToRequest("requestCourseDetailsData", { ok: false, error: { message: "no courses" } })

    await expect(outcome).resolves.toEqual({ ok: false, error: { message: "no courses" } })
  })

  test("ignores a reply to any other request", async () => {
    const { request } = mountRequester()
    const settled = vi.fn()

    void request("requestCourseDetailsData", { sourcePanel }).then(settled)
    const posted = postedMessages.mock.calls.at(-1)?.[0] as { requestId: number }
    replyToRequest("requestCourseDetailsData", { ok: true }, posted.requestId + 1)
    await Promise.resolve()

    expect(settled).not.toHaveBeenCalled()
  })

  test("gives up after the timeout it was given", async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { request } = mountRequester()

    const outcome = request("requestCourseDetailsData", { sourcePanel }, { timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)

    await expect(outcome).resolves.toEqual({
      ok: false,
      error: { message: "The extension did not answer in time." },
    })
  })

  test("fails at once when the request cannot be posted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { request } = mountRequester()

    const outcome = request("copyToClipboard", {
      sourcePanel: { id: 5, type: "NotAPanel" },
      text: "x",
    } as never)

    await expect(outcome).resolves.toMatchObject({ ok: false })
  })

  test("abandons its requests, and their timers, when the component is destroyed", async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { request, unmount } = mountRequester()
    const settled = vi.fn()

    void request("requestCourseDetailsData", { sourcePanel }, { timeoutMs: 1000 }).then(settled)
    unmount()

    expect(vi.getTimerCount()).toBe(0)
    replyToRequest("requestCourseDetailsData", { ok: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).not.toHaveBeenCalled()
  })

  test("keeps replies away from the panels' message listeners", () => {
    const listener = vi.fn()
    render(MessageListenerProbe, { props: { panel: sourcePanel, onmessage: listener } })
    const { request } = mountRequester()

    void request("requestCourseDetailsData", { sourcePanel })
    replyToRequest("requestCourseDetailsData", { ok: true })

    expect(listener).not.toHaveBeenCalled()
  })
})
