import { fireEvent, render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import ActionBar from "./ActionBar.svelte"

function buttons(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("vscode-button")]
}

suite("ActionBar component", () => {
  test("renders the primary first, then the secondary buttons", async () => {
    const onRun = vi.fn()
    render(ActionBar, {
      props: {
        primary: { label: "Run Tests", onclick: onRun },
        secondary: [{ label: "Submit Again", onclick: vi.fn() }],
      },
    })
    const [primary, secondary] = buttons()
    expect(primary).toHaveTextContent("Run Tests")
    expect((primary as HTMLElement & { secondary: boolean }).secondary).toBe(false)
    expect(secondary).toHaveTextContent("Submit Again")
    expect((secondary as HTMLElement & { secondary: boolean }).secondary).toBe(true)
    await fireEvent.click(screen.getByText("Run Tests"))
    expect(onRun).toHaveBeenCalledOnce()
  })

  test("drops the icons unless every button has one", () => {
    render(ActionBar, {
      props: {
        primary: { label: "Run Tests", icon: "beaker", onclick: vi.fn() },
        secondary: [{ label: "Submit Again", onclick: vi.fn() }],
      },
    })
    expect(buttons().map((button) => (button as HTMLElement & { icon: string }).icon)).toEqual([
      "",
      "",
    ])
  })

  test("renders nothing without actions", () => {
    const { container } = render(ActionBar, { props: {} })
    expect(container.firstElementChild).toBeNull()
  })
})
