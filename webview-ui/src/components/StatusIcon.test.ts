import { render, screen } from "@testing-library/svelte"

import StatusIcon from "./StatusIcon.svelte"

function icon(container: HTMLElement) {
  return container.querySelector("vscode-icon")!
}

suite("StatusIcon component", () => {
  test("pairs a coloured codicon with the status in words for screen readers", () => {
    const { container } = render(StatusIcon, { props: { status: "passed", label: "Passed" } })
    expect(icon(container).name).toBe("pass-filled")
    expect(icon(container)).toHaveClass("tone-passed")
    expect(screen.getByText("Passed")).toHaveClass("visually-hidden")
  })
})
