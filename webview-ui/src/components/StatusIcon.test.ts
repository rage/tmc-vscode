import { render, screen } from "@testing-library/svelte"

import StatusIcon from "./StatusIcon.svelte"

function icon(container: HTMLElement) {
  return container.querySelector("vscode-icon")!
}

suite("StatusIcon component", () => {
  test("pairs a coloured codicon with the status in words", () => {
    const { container } = render(StatusIcon, { props: { status: "passed", label: "Passed" } })
    expect(icon(container).name).toBe("pass-filled")
    expect(icon(container)).toHaveClass("tone-passed")
    expect(screen.getByText("Passed")).not.toHaveClass("visually-hidden")
  })

  test("draws a not-yet-passed exercise as an outline, not an error", () => {
    const { container } = render(StatusIcon, { props: { status: "unset", label: "Not completed" } })
    expect(icon(container).name).toBe("circle-large-outline")
    expect(icon(container)).toHaveClass("tone-unset")
  })

  test("mutes the text of a local state", () => {
    const { container } = render(StatusIcon, {
      props: { status: "missing", label: "Not downloaded" },
    })
    expect(icon(container).name).toBe("cloud-download")
    expect(container.querySelector(".status")).toHaveClass("muted")
  })

  test("can keep the label for screen readers only", () => {
    render(StatusIcon, { props: { status: "failed", label: "Failed", isLabelHidden: true } })
    expect(screen.getByText("Failed")).toHaveClass("visually-hidden")
  })

  test("spins while downloading unless motion is reduced", async () => {
    const { container, unmount } = render(StatusIcon, {
      props: { status: "downloading", label: "Downloading" },
    })
    expect(icon(container).spin).toBe(true)
    unmount()

    document.body.classList.add("vscode-reduce-motion")
    try {
      const reduced = render(StatusIcon, { props: { status: "downloading", label: "Downloading" } })
      expect(icon(reduced.container).spin).toBe(false)
    } finally {
      document.body.classList.remove("vscode-reduce-motion")
    }
  })
})
