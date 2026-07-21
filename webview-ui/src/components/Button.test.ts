import { fireEvent, render } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import Button from "./Button.svelte"

function label(text: string) {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

suite("Button component", () => {
  test("renders a vscode-button with the child label and no redundant a11y attributes", () => {
    const { container } = render(Button, { props: { children: label("Download") } })
    const button = container.querySelector("vscode-button")
    expect(button).not.toBeNull()
    expect(button?.textContent?.trim()).toBe("Download")
    // Re-adding these caused a double-fire (see Button.svelte).
    expect(button?.hasAttribute("role")).toBe(false)
    expect(button?.hasAttribute("tabindex")).toBe(false)
    expect(button?.getAttribute("onkeypress")).toBeNull()
  })

  test("fires onclick exactly once per click", async () => {
    const onclick = vi.fn()
    const { container } = render(Button, { props: { onclick, children: label("Go") } })
    const button = container.querySelector("vscode-button")!
    await fireEvent.click(button)
    expect(onclick).toHaveBeenCalledTimes(1)
  })

  test("forwards secondary, disabled and aria-label", () => {
    const { container } = render(Button, {
      props: { secondary: true, disabled: true, "aria-label": "Close", children: label("×") },
    })
    const button = container.querySelector("vscode-button")!
    expect(button.hasAttribute("secondary")).toBe(true)
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(button.getAttribute("aria-label")).toBe("Close")
  })

  test("omits secondary and disabled when false", () => {
    const { container } = render(Button, {
      props: { secondary: false, disabled: false, children: label("Plain") },
    })
    const button = container.querySelector("vscode-button")!
    expect(button.hasAttribute("secondary")).toBe(false)
    expect(button.hasAttribute("disabled")).toBe(false)
  })
})
