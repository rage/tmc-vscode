import { fireEvent, render } from "@testing-library/svelte"
import type { VscodeCheckbox } from "@vscode-elements/elements"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import { withinShadowRoot } from "../test/shadow"
import Checkbox from "./Checkbox.svelte"

async function renderCheckbox(props: Record<string, unknown>): Promise<{
  element: VscodeCheckbox
  rerender: (p: object) => Promise<void>
}> {
  const { container, rerender } = render(Checkbox, { props: { checked: false, ...props } })
  const element = container.querySelector("vscode-checkbox")!
  await element.updateComplete
  return {
    element,
    rerender: async (next) => {
      await rerender(next)
      await element.updateComplete
    },
  }
}

suite("Checkbox component", () => {
  test("names the inner input from visible slotted text", async () => {
    const { element } = await renderCheckbox({
      children: createRawSnippet(() => ({ render: () => "<span>Show passed tests</span>" })),
    })
    expect((await withinShadowRoot(element)).getByRole("checkbox")).toHaveAccessibleName(
      "Show passed tests",
    )
  })

  test("reports the requested state without moving until the parent agrees", async () => {
    const oncheckedchange = vi.fn()
    const { element } = await renderCheckbox({ oncheckedchange })

    await fireEvent.keyDown(element, { key: " " })

    expect(oncheckedchange).toHaveBeenCalledExactlyOnceWith(true)
    expect(element.checked).toBe(false)
  })

  test("follows checked once the parent accepts the toggle", async () => {
    const { element, rerender } = await renderCheckbox({
      oncheckedchange: (next: boolean) => void rerender({ checked: next }),
    })

    await fireEvent.keyDown(element, { key: " " })

    await vi.waitFor(() => expect(element.checked).toBe(true))
  })

  test("passes element props through", async () => {
    const { element } = await renderCheckbox({ disabled: true, hidden: true })
    expect(element.disabled).toBe(true)
    expect(element).toHaveAttribute("hidden")
  })
})
