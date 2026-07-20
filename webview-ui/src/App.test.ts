import { render } from "@testing-library/svelte"

import App from "./App.svelte"

// App installs global error/unhandledrejection handlers on mount that replace
// the page body with an error message, so an otherwise-blank webview at least
// tells the user something went wrong. Both paths are exercised here.
suite("App global error handling", () => {
  test("renders the loading placeholder for the initial App panel", () => {
    render(App)
    expect(document.body.textContent).toContain("Loading TestMyCode...")
  })

  test("replaces the body with an error message on an uncaught error", () => {
    render(App)

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        error: new Error("boom"),
      }),
    )

    expect(document.body.innerHTML).toContain("Uncaught error: boom")
    expect(document.body.innerHTML).toContain("This is a bug in the extension.")
  })

  test("replaces the body with an error message on an unhandled rejection", () => {
    render(App)
    expect(typeof window.onunhandledrejection).toBe("function")

    const reason = new Error("rejected")
    // invoked directly: jsdom does not fire `unhandledrejection` for real
    // rejected promises, and App assigns the handler as a property
    window.onunhandledrejection?.({ reason } as unknown as PromiseRejectionEvent)

    expect(document.body.innerHTML).toContain("Unhandled rejection: rejected")
    expect(document.body.innerHTML).toContain("This is a bug in the extension.")
  })
})
