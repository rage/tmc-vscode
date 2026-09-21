import { render, screen, waitFor } from "@testing-library/svelte"
import { tick } from "svelte"

import App from "./App.svelte"
import { findButton } from "./test/dom"
import { tmcLocalCourse } from "./test/fixtures"
import { dispatchToWebview, postedMessages } from "./test/setup"

suite("App global error handling", () => {
  test("renders the loading placeholder for the initial App panel", () => {
    render(App)
    expect(document.body.textContent).toContain("Loading TestMyCode…")
  })

  test("shows an error message on an uncaught window error", async () => {
    render(App)

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        error: new Error("boom"),
      }),
    )

    await waitFor(() => {
      expect(document.body.innerHTML).toContain("Uncaught error: boom")
      expect(document.body.innerHTML).toContain("This is a bug in the extension.")
    })
  })

  test("shows an error message on an unhandled rejection", async () => {
    render(App)

    // jsdom does not fire `unhandledrejection` for real rejected promises.
    const event = new Event("unhandledrejection") as Event & { reason: unknown }
    event.reason = new Error("rejected")
    window.dispatchEvent(event)

    await waitFor(() => {
      expect(document.body.innerHTML).toContain("Unhandled rejection: rejected")
      expect(document.body.innerHTML).toContain("This is a bug in the extension.")
    })
  })

  test("the crash view offers a way back to the panel that crashed", async () => {
    render(App)
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: new Error("boom") }))
    await waitFor(() => {
      expect(document.body.innerHTML).toContain("Uncaught error: boom")
    })

    postedMessages.mockClear()
    ;(await findButton("Reload")).click()

    await waitFor(() => {
      expect(document.body.innerHTML).not.toContain("This is a bug in the extension.")
    })
    expect(postedMessages).toHaveBeenCalledWith({ type: "ready" })
  })
})

suite("App reload handshake", () => {
  test("asks the extension to resend the current panel on mount", () => {
    render(App)
    expect(postedMessages).toHaveBeenCalledWith({ type: "ready" })
  })

  test("renders a message that arrives right after the panel it targets", async () => {
    // The extension answers "ready" with setPanel and then replays its buffer. Each
    // postMessage is its own task in production, so the child panel has mounted and
    // registered its listener before the next message lands. jsdom's dispatchEvent is
    // synchronous, so the `tick` below stands in for that gap -- without it this test
    // would pass for the wrong reason, or fail for one.
    render(App)
    const course = tmcLocalCourse({ title: "Ordering Course" })

    dispatchToWebview({
      type: "setPanel",
      target: { id: 0, type: "App" },
      panel: { id: 7, type: "MyCourses", courseDeadlines: {} },
    })
    await tick()

    dispatchToWebview({
      type: "setMyCourses",
      target: { id: 7, type: "MyCourses" },
      courses: [course],
    })

    expect(await screen.findByText("Ordering Course")).toBeInTheDocument()
  })
})
