import { render, waitFor } from "@testing-library/svelte"

import App from "./App.svelte"

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
})
