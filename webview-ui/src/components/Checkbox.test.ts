import { fireEvent, render, waitFor } from "@testing-library/svelte"
import { vi } from "vitest"

import Checkbox from "./Checkbox.svelte"

type CheckboxElement = HTMLElement & { checked: boolean; indeterminate: boolean }

// vscode-checkbox is inert under jsdom, so setting `.checked` and dispatching `change`
// stands in for a real user toggle.
function renderCheckbox(props: Record<string, unknown>): {
  el: CheckboxElement
  container: HTMLElement
} {
  const { container } = render(Checkbox, { props })
  const el = container.querySelector("vscode-checkbox") as CheckboxElement
  return { el, container }
}

suite("Checkbox component", () => {
  test("renders a single checkbox element, not a role=button span", () => {
    const { el, container } = renderCheckbox({ checked: false })
    expect(el).not.toBeNull()
    // the old span+role="button" wrapper (two tab stops, wrong role) is gone
    expect(container.querySelector('[role="button"]')).toBeNull()
  })

  test("exposes an accessible name via aria-label", () => {
    const { el } = renderCheckbox({ checked: false, "aria-label": "Select all exercises" })
    expect(el.getAttribute("aria-label")).toBe("Select all exercises")
  })

  test("mirrors the controlled checked/indeterminate props onto the element", async () => {
    const { el } = renderCheckbox({ checked: true, indeterminate: true })
    await waitFor(() => {
      expect(el.checked).toBe(true)
      expect(el.indeterminate).toBe(true)
    })
  })

  test("fires onClick exactly once with the toggled value on change", async () => {
    const onClick = vi.fn()
    const { el } = renderCheckbox({ checked: false, onClick })

    el.checked = true
    await fireEvent.change(el)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenLastCalledWith(true)
  })

  test("reports the new value on each successive toggle", async () => {
    const onClick = vi.fn()
    const { el } = renderCheckbox({ checked: false, onClick })

    el.checked = true
    await fireEvent.change(el)
    el.checked = false
    await fireEvent.change(el)

    expect(onClick.mock.calls).toEqual([[true], [false]])
  })
})
