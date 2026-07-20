import { render, screen } from "@testing-library/svelte"

import ProgressBar from "./ProgressBar.svelte"

suite("ProgressBar component", () => {
  test("renders its label", () => {
    render(ProgressBar, { props: { label: "Points: 50%", value: 1, max: 2 } })
    expect(screen.getByText("Points: 50%")).toBeInTheDocument()
  })

  test("sets the bar width to value/max", () => {
    const { container } = render(ProgressBar, { props: { label: "p", value: 1, max: 4 } })
    const background = container.querySelector<HTMLElement>(".background")
    expect(background?.style.getPropertyValue("--bar-width")).toBe("0.25")
  })

  test("clamps the width to 0 when max is 0 (avoids divide-by-zero)", () => {
    const { container } = render(ProgressBar, { props: { label: "p", value: 3, max: 0 } })
    const background = container.querySelector<HTMLElement>(".background")
    expect(background?.style.getPropertyValue("--bar-width")).toBe("0")
  })
})
