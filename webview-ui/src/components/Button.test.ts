import { fireEvent, render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import Button from "./Button.svelte"

function label(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

suite("Button component", () => {
  test("renders a vscode-button exposed as a button named by its content", async () => {
    render(Button, { props: { children: label("Download") } })
    const button = await screen.findByRole("button", { name: "Download" })
    expect(button.tagName).toBe("VSCODE-BUTTON")
  })

  test("fires onclick exactly once per click", async () => {
    const onclick = vi.fn()
    render(Button, { props: { onclick, children: label("Go") } })
    await fireEvent.click(await screen.findByRole("button", { name: "Go" }))
    expect(onclick).toHaveBeenCalledTimes(1)
  })

  test("activates once on Space and stops the page from scrolling", async () => {
    const onclick = vi.fn()
    const onkeydown = vi.fn()
    render(Button, { props: { onclick, onkeydown, children: label("Go") } })
    const button = await screen.findByRole("button", { name: "Go" })

    const notCancelled = await fireEvent.keyDown(button, { key: " " })

    expect(notCancelled).toBe(false)
    expect(onclick).toHaveBeenCalledTimes(1)
    expect(onkeydown).toHaveBeenCalledTimes(1)
  })

  test("leaves the default action of other keys alone", async () => {
    render(Button, { props: { children: label("Go") } })
    const button = await screen.findByRole("button", { name: "Go" })
    expect(await fireEvent.keyDown(button, { key: "Enter" })).toBe(true)
  })

  test("passes element properties and aria attributes through", async () => {
    const { container } = render(Button, {
      props: {
        secondary: true,
        disabled: true,
        icon: "close",
        "icon-only": true,
        "aria-label": "Close",
        "aria-expanded": false,
      },
    })
    const button = container.querySelector("vscode-button")!
    await button.updateComplete
    expect(button.secondary).toBe(true)
    expect(button.disabled).toBe(true)
    expect(button.icon).toBe("close")
    expect(button.iconOnly).toBe(true)
    expect(button).toHaveAttribute("aria-label", "Close")
    expect(button).toHaveAttribute("aria-expanded", "false")
  })

  test("renders false boolean props as unset", async () => {
    render(Button, { props: { secondary: false, disabled: false, children: label("Plain") } })
    const button = await screen.findByRole("button", { name: "Plain" })
    expect(button).not.toHaveAttribute("secondary")
    expect(button).not.toHaveAttribute("disabled")
  })
})
