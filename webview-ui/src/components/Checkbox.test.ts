import { fireEvent, render } from "@testing-library/svelte"
import type { VscodeCheckbox } from "@vscode-elements/elements"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import { withinShadowRoot } from "../test/shadow"
import Checkbox from "./Checkbox.svelte"

async function renderCheckbox(props: Record<string, unknown>): Promise<{
  element: VscodeCheckbox
  input: HTMLInputElement
  rerender: (p: object) => Promise<void>
}> {
  const { container, rerender } = render(Checkbox, { props: { checked: false, ...props } })
  const element = container.querySelector("vscode-checkbox")!
  await element.updateComplete
  const input = element.shadowRoot!.querySelector("input")!
  return {
    element,
    input,
    rerender: async (next) => {
      await rerender(next)
      await element.updateComplete
    },
  }
}

suite("Checkbox component", () => {
  test("names the focusable inner input from accessibleName", async () => {
    const { element } = await renderCheckbox({ accessibleName: "Select part01-01" })
    expect((await withinShadowRoot(element)).getByRole("checkbox")).toHaveAccessibleName(
      "Select part01-01",
    )
  })

  test("names the inner input from visible slotted text", async () => {
    const { element } = await renderCheckbox({
      children: createRawSnippet(() => ({ render: () => "<span>Show passed tests</span>" })),
    })
    expect((await withinShadowRoot(element)).getByRole("checkbox")).toHaveAccessibleName(
      "Show passed tests",
    )
  })

  test("exposes the indeterminate state on the inner input", async () => {
    const { input, rerender } = await renderCheckbox({ indeterminate: true })
    await vi.waitFor(() => expect(input.indeterminate).toBe(true))

    await rerender({ indeterminate: false })
    await vi.waitFor(() => expect(input.indeterminate).toBe(false))
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

  test("keeps indeterminate after a toggle the parent ignores", async () => {
    const { element } = await renderCheckbox({ indeterminate: true })

    await fireEvent.keyDown(element, { key: " " })

    expect(element.indeterminate).toBe(true)
  })

  test("passes element props through", async () => {
    const { element } = await renderCheckbox({ disabled: true, hidden: true })
    expect(element.disabled).toBe(true)
    expect(element).toHaveAttribute("hidden")
  })
})
