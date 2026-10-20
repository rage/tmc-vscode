import { render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"

import StatusBanner from "./StatusBanner.svelte"

suite("StatusBanner component", () => {
  test("titles the state with a level-2 heading and shows its explanation", () => {
    render(StatusBanner, {
      props: {
        tone: "failed",
        title: "Some tests failed on the server",
        children: createRawSnippet(() => ({ render: () => "<p>1 of 3 tests passed</p>" })),
      },
    })
    expect(
      screen.getByRole("heading", { level: 2, name: "Some tests failed on the server" }),
    ).toBeInTheDocument()
    expect(screen.getByText("1 of 3 tests passed")).toBeInTheDocument()
  })

  test("is not a live region, so it does not interrupt on every render", () => {
    render(StatusBanner, { props: { tone: "progress", title: "Processing submission…" } })
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
