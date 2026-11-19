import { fireEvent, render, screen } from "@testing-library/svelte"
import { vi } from "vitest"

import { withinShadowRoot } from "../test/shadow"
import CodeBlock from "./CodeBlock.svelte"

suite("CodeBlock component", () => {
  test("renders the text verbatim in a pre", () => {
    const { container } = render(CodeBlock, { props: { code: "line 1\n  line 2" } })
    expect(container.querySelector("pre")!.textContent).toBe("line 1\n  line 2")
    expect(screen.queryByRole("group")).not.toBeInTheDocument()
  })

  test("a labelled block is a named group with a copy button that hands the text back", async () => {
    const oncopy = vi.fn()
    const { container } = render(CodeBlock, {
      props: { code: "Traceback …", label: "Stack trace", oncopy },
    })
    expect(screen.getByRole("group", { name: "Stack trace" })).toBeInTheDocument()

    const copy = container.querySelector("vscode-toolbar-button")!
    await fireEvent.click(
      (await withinShadowRoot(copy)).getByRole("button", { name: "Copy Stack trace" }),
    )
    expect(oncopy).toHaveBeenCalledExactlyOnceWith("Traceback …")
  })
})
