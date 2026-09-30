import { fireEvent, render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import { reloadDocument } from "../test/setup"
import { enterScreen } from "../utilities/uiState.svelte"
import Disclosure from "./Disclosure.svelte"

const body = createRawSnippet(() => ({ render: () => "<p>Exercise table</p>" }))

suite("Disclosure component", () => {
  test("is a native button inside a heading, collapsed by default", () => {
    render(Disclosure, { props: { title: "part01", children: body } })
    const heading = screen.getByRole("heading", { level: 2 })
    const toggle = screen.getByRole("button", { name: "part01" })
    expect(heading).toContainElement(toggle)
    // Enter and Space activate a native button without any key handling of our own.
    expect(toggle).toHaveAttribute("type", "button")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("Exercise table")).not.toBeVisible()
  })

  test("toggles the region and reports the new state", async () => {
    const ontoggle = vi.fn()
    render(Disclosure, { props: { title: "part01", children: body, ontoggle } })
    const toggle = screen.getByRole("button", { name: "part01" })

    await fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(document.querySelector(`[id="${toggle.getAttribute("aria-controls")}"]`)).toBeVisible()
    expect(ontoggle).toHaveBeenCalledExactlyOnceWith(true)
  })

  test("starts open and at the requested heading level when asked", () => {
    render(Disclosure, {
      props: { title: "part02", open: true, headingLevel: 3, description: "3 / 5", children: body },
    })
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "part02 3 / 5" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    expect(screen.getByText("Exercise table")).toBeVisible()
  })

  test("keeps section actions outside the toggle", () => {
    render(Disclosure, {
      props: {
        title: "part01",
        children: body,
        actions: createRawSnippet(() => ({ render: () => "<button>Download all</button>" })),
      },
    })
    const toggle = screen.getByRole("button", { name: "part01" })
    expect(toggle).not.toContainElement(screen.getByRole("button", { name: "Download all" }))
  })

  test("a persisted one comes back open after its document reloads", async () => {
    const helpPanel = { id: 1, type: "InitializationErrorHelp" } as const
    enterScreen(helpPanel)
    render(Disclosure, { props: { title: "Stack trace", persistAs: "stack", children: body } })
    await fireEvent.click(screen.getByRole("button", { name: "Stack trace" }))

    reloadDocument()
    enterScreen(helpPanel)
    render(Disclosure, { props: { title: "Stack trace", persistAs: "stack", children: body } })

    expect(screen.getByRole("button", { name: "Stack trace" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })
})
