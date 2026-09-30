import { fireEvent, render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"

import { initializationErrorHelpPanel } from "../test/fixtures"
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

  test("toggles the region", async () => {
    render(Disclosure, { props: { title: "part01", children: body } })
    const toggle = screen.getByRole("button", { name: "part01" })

    await fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(document.querySelector(`[id="${toggle.getAttribute("aria-controls")}"]`)).toBeVisible()
  })

  test("sits at the requested heading level", () => {
    render(Disclosure, { props: { title: "part02", headingLevel: 3, children: body } })
    expect(screen.getByRole("heading", { level: 3 })).toContainElement(
      screen.getByRole("button", { name: "part02" }),
    )
  })

  test("a persisted one comes back open after its document reloads", async () => {
    const helpPanel = initializationErrorHelpPanel()
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
