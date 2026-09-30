import { render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import PanelHeader from "./PanelHeader.svelte"

suite("PanelHeader component", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("focuses its heading on mount so navigation does not drop focus to the body", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    render(PanelHeader, { props: { title: "My Courses" } })
    const heading = screen.getByRole("heading", { level: 1, name: "My Courses" })
    expect(heading).toHaveAttribute("tabindex", "-1")
    expect(heading).toHaveFocus()
  })

  test("leaves focus alone when asked", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    render(PanelHeader, { props: { title: "Tests: part01-01", shouldFocusOnMount: false } })
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus()
  })

  test("renders trailing actions", () => {
    render(PanelHeader, {
      props: {
        title: "Python Course",
        actions: createRawSnippet(() => ({ render: () => "<button>Refresh</button>" })),
      },
    })
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument()
  })
})
