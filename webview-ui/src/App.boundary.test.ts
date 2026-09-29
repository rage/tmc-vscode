import { screen, render, waitFor } from "@testing-library/svelte"

import App from "./App.svelte"
import { dispatchToWebview, postedMessages } from "./test/setup"

vi.mock("./panels/Welcome.svelte", async () => ({
  default: (await import("./test/ThrowingPanel.svelte")).default,
}))

suite("App render-crash boundary", () => {
  test("a panel that crashes while rendering does not block the next panel", async () => {
    render(App)
    dispatchToWebview({
      type: "setPanel",
      target: { id: 0, type: "App" },
      panel: { id: 1, type: "Welcome" },
    })
    expect(await screen.findByText("Uncaught error: render boom")).toBeInTheDocument()
    expect(postedMessages).toHaveBeenCalledWith({
      type: "webviewError",
      message: "Uncaught error: render boom",
      stack: expect.stringContaining("render boom"),
    })

    postedMessages.mockClear()
    dispatchToWebview({
      type: "setPanel",
      target: { id: 0, type: "App" },
      panel: { id: 2, type: "MyCourses" },
    })

    await waitFor(() => {
      expect(screen.queryByText("Uncaught error: render boom")).not.toBeInTheDocument()
    })
    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ type: "requestMyCoursesData" }),
    )
  })
})
