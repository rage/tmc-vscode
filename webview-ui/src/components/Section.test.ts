import { render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"

import Section from "./Section.svelte"

suite("Section component", () => {
  test("is a region named by its level-2 heading", () => {
    render(Section, {
      props: {
        title: "Tests",
        children: createRawSnippet(() => ({ render: () => "<p>3 of 4 tests passed</p>" })),
      },
    })
    expect(screen.getByRole("heading", { level: 2, name: "Tests" })).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Tests" })).toHaveTextContent("3 of 4 tests passed")
  })
})
