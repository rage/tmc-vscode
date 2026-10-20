import { fireEvent, render, screen } from "@testing-library/svelte"
import { tick } from "svelte"
import { vi } from "vitest"

import ActionMenu from "./ActionMenu.svelte"

function renderMenu() {
  const onBrowser = vi.fn()
  const onSolution = vi.fn()
  render(ActionMenu, {
    props: {
      actions: [
        { label: "Show Submission in Browser", onselect: onBrowser },
        { label: "Disabled Action", onselect: vi.fn(), disabled: true },
        { label: "Show Model Solution", onselect: onSolution },
      ],
    },
  })
  return { trigger: screen.getByRole("button", { name: "More Actions" }), onBrowser, onSolution }
}

suite("ActionMenu component", () => {
  test("renders nothing without actions", () => {
    const { container } = render(ActionMenu, { props: { actions: [] } })
    expect(container.firstElementChild).toBeNull()
  })

  test("is a collapsed menu button until clicked", async () => {
    const { trigger } = renderMenu()
    expect(trigger).toHaveAttribute("aria-haspopup", "menu")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()

    await fireEvent.click(trigger)
    await tick()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    const menu = screen.getByRole("menu", { name: "More Actions" })
    expect(trigger).toHaveAttribute("aria-controls", menu.id)
    expect(screen.getByRole("menuitem", { name: "Show Submission in Browser" })).toHaveFocus()
  })

  test("moves between enabled items with the arrow keys, wrapping around", async () => {
    const { trigger } = renderMenu()
    await fireEvent.keyDown(trigger, { key: "ArrowDown" })
    await tick()
    const first = screen.getByRole("menuitem", { name: "Show Submission in Browser" })
    const last = screen.getByRole("menuitem", { name: "Show Model Solution" })
    expect(first).toHaveFocus()
    await fireEvent.keyDown(first, { key: "ArrowDown" })
    expect(last).toHaveFocus()
    await fireEvent.keyDown(last, { key: "ArrowDown" })
    expect(first).toHaveFocus()
    await fireEvent.keyDown(first, { key: "End" })
    expect(last).toHaveFocus()
  })

  test("opens on the last item with ArrowUp", async () => {
    const { trigger } = renderMenu()
    await fireEvent.keyDown(trigger, { key: "ArrowUp" })
    await tick()
    expect(screen.getByRole("menuitem", { name: "Show Model Solution" })).toHaveFocus()
  })

  test("runs the chosen action with focus back on the trigger", async () => {
    const { trigger, onSolution } = renderMenu()
    await fireEvent.click(trigger)
    await tick()
    onSolution.mockImplementation(() => {
      expect(trigger).toHaveFocus()
    })
    await fireEvent.click(screen.getByRole("menuitem", { name: "Show Model Solution" }))
    expect(onSolution).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  test("closes on Escape and returns focus to the trigger", async () => {
    const { trigger, onBrowser } = renderMenu()
    await fireEvent.click(trigger)
    await tick()
    await fireEvent.keyDown(screen.getByRole("menuitem", { name: "Show Submission in Browser" }), {
      key: "Escape",
    })
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onBrowser).not.toHaveBeenCalled()
  })

  test("closes on a pointer press outside it", async () => {
    const { trigger } = renderMenu()
    await fireEvent.click(trigger)
    await tick()
    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })
})
