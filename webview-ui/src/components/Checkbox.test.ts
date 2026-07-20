import { fireEvent, render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import Checkbox from "./Checkbox.svelte"

// The real double-fire this guards against comes from `vscode-checkbox`'s
// internal `<label for=input>`, whose default click action re-fires a synthetic
// click on the inner input. That custom element is not upgraded under jsdom, so
// the doubling itself cannot be reproduced here; instead we pin the invariant
// that stops it — `onClickWrapper` calls `preventDefault()` and toggles exactly
// once per click. Reverting the `preventDefault()` fix flips these assertions.
suite("Checkbox component", () => {
  test("fires onClick exactly once per click, with the toggled value", async () => {
    const onClick = vi.fn()
    render(Checkbox, { props: { checked: false, onClick } })

    const box = screen.getByRole("button")
    await fireEvent.click(box)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenLastCalledWith(true)
  })

  test("cancels the click's default action (the anti-double-fire guard)", async () => {
    const onClick = vi.fn()
    render(Checkbox, { props: { checked: false, onClick } })

    const box = screen.getByRole("button")
    // fireEvent returns false when a handler called preventDefault on a
    // cancelable event
    const notCancelled = await fireEvent.click(box)

    expect(notCancelled).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test("toggles back and forth across successive clicks", async () => {
    const onClick = vi.fn()
    render(Checkbox, { props: { checked: false, onClick } })

    const box = screen.getByRole("button")
    await fireEvent.click(box)
    await fireEvent.click(box)

    expect(onClick.mock.calls).toEqual([[true], [false]])
  })
})
