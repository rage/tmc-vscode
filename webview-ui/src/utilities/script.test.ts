import { render } from "@testing-library/svelte"

import MessageListenerProbe from "../test/MessageListenerProbe.svelte"
import { dispatchToWebview } from "../test/setup"

const myCourses = { id: 5, type: "MyCourses" as const }
const setMyCourses = {
  type: "setMyCourses",
  target: { id: 5, type: "MyCourses" },
  courses: [],
} as const

afterEach(() => {
  vi.restoreAllMocks()
})

suite("addMessageListener", () => {
  test("delivers a message only to listeners of its target panel", () => {
    const listening = vi.fn()
    const other = vi.fn()
    render(MessageListenerProbe, { props: { panel: myCourses, onmessage: listening } })
    render(MessageListenerProbe, {
      props: { panel: { ...myCourses, id: 6 }, onmessage: other },
    })

    dispatchToWebview(setMyCourses)

    expect(listening).toHaveBeenCalledWith(setMyCourses)
    expect(other).not.toHaveBeenCalled()
  })

  test("validates an invalid message once however many components listen", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const listener = vi.fn()
    render(MessageListenerProbe, { props: { panel: myCourses, onmessage: listener } })
    render(MessageListenerProbe, { props: { panel: myCourses, onmessage: listener } })

    window.dispatchEvent(new MessageEvent("message", { data: { type: "notAMessage" } }))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
  })

  test("stops delivering once the listening component is destroyed", () => {
    const listener = vi.fn()
    const { unmount } = render(MessageListenerProbe, {
      props: { panel: myCourses, onmessage: listener },
    })
    unmount()

    dispatchToWebview(setMyCourses)

    expect(listener).not.toHaveBeenCalled()
  })
})
