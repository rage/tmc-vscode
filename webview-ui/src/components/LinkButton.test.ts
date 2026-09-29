import { fireEvent, render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import LinkButton from "./LinkButton.svelte"

const label = createRawSnippet(() => ({ render: () => "<span>Change path</span>" }))

suite("LinkButton component", () => {
  test("is a native, non-submitting button", async () => {
    const onclick = vi.fn()
    render(LinkButton, { props: { onclick, children: label } })
    const button = screen.getByRole("button", { name: "Change path" })
    expect(button).toHaveAttribute("type", "button")
    await fireEvent.click(button)
    expect(onclick).toHaveBeenCalledOnce()
  })

  test("passes attributes and classes through", () => {
    render(LinkButton, {
      props: { class: "crumb", "aria-current": "page", disabled: true, children: label },
    })
    const button = screen.getByRole("button", { name: "Change path" })
    expect(button).toHaveClass("link-button", "crumb")
    expect(button).toHaveAttribute("aria-current", "page")
    expect(button).toBeDisabled()
  })
})
