import { fireEvent, render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"
import { vi } from "vitest"

import { withinShadowRoot } from "../test/shadow"
import Notice from "./Notice.svelte"

const text = (content: string) => createRawSnippet(() => ({ render: () => `<p>${content}</p>` }))

suite("Notice component", () => {
  test("an error is an alert with an error icon", () => {
    const { container } = render(Notice, {
      props: { kind: "error", title: "Could not load courses", children: text("Timed out") },
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load courses")
    expect(container.querySelector("vscode-icon")!.name).toBe("error")
  })

  test("info and warnings are polite statuses", () => {
    render(Notice, { props: { kind: "warning", children: text("Offline mode") } })
    expect(screen.getByRole("status")).toHaveTextContent("Offline mode")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  test("renders actions and a named dismiss button", async () => {
    const ondismiss = vi.fn()
    const { container } = render(Notice, {
      props: {
        kind: "info",
        children: text("3 new exercises"),
        actions: createRawSnippet(() => ({ render: () => "<button>Download them</button>" })),
        ondismiss,
        dismissLabel: "Dismiss new exercises",
      },
    })
    expect(screen.getByRole("button", { name: "Download them" })).toBeInTheDocument()

    const dismiss = container.querySelector("vscode-toolbar-button")!
    await fireEvent.click(
      (await withinShadowRoot(dismiss)).getByRole("button", { name: "Dismiss new exercises" }),
    )
    expect(ondismiss).toHaveBeenCalledOnce()
  })
})
