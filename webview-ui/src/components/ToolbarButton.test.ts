import { fireEvent, render } from "@testing-library/svelte"
import { vi } from "vitest"

import { withinShadowRoot } from "../test/shadow"
import ToolbarButton from "./ToolbarButton.svelte"

suite("ToolbarButton component", () => {
  test("is a native button named and titled by its label", async () => {
    const { container } = render(ToolbarButton, {
      props: { icon: "close", label: "Close test results" },
    })
    const host = container.querySelector("vscode-toolbar-button")!
    const button = (await withinShadowRoot(host)).getByRole("button", {
      name: "Close test results",
    })
    expect(button.tagName).toBe("BUTTON")
    expect(host).toHaveAttribute("title", "Close test results")
    expect(host.icon).toBe("close")
  })

  test("fires onclick once when its inner button is clicked", async () => {
    const onclick = vi.fn()
    const { container } = render(ToolbarButton, { props: { icon: "copy", label: "Copy", onclick } })
    const host = container.querySelector("vscode-toolbar-button")!
    await fireEvent.click((await withinShadowRoot(host)).getByRole("button"))
    expect(onclick).toHaveBeenCalledOnce()
  })
})
