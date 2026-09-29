import { render, screen } from "@testing-library/svelte"

import Spinner from "./Spinner.svelte"

suite("Spinner component", () => {
  test("hides the ring beside a visible label instead of raising an alert", async () => {
    const { container } = render(Spinner, { props: { label: "Loading courses" } })
    const ring = container.querySelector("vscode-progress-ring")!
    await ring.updateComplete
    expect(screen.getByText("Loading courses")).toBeVisible()
    expect(ring).toHaveAttribute("role", "presentation")
    expect(ring).toHaveAttribute("aria-hidden", "true")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  test("becomes a polite status named by the label when the label is hidden", async () => {
    const { container } = render(Spinner, {
      props: { label: "Running tests", isLabelHidden: true },
    })
    await container.querySelector("vscode-progress-ring")!.updateComplete
    const status = screen.getByRole("status", { name: "Running tests" })
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
