import { render, screen } from "@testing-library/svelte"

import Meter from "./Meter.svelte"

function fillFraction(meter: HTMLElement): string {
  return meter.style.getPropertyValue("--meter-fraction")
}

suite("Meter component", () => {
  test("is a meter named by its label and read out as a count", () => {
    render(Meter, { props: { label: "Points", value: 3, max: 5 } })
    const meter = screen.getByRole("meter", { name: "Points" })
    expect(meter).toHaveAttribute("aria-valuenow", "3")
    expect(meter).toHaveAttribute("aria-valuemin", "0")
    expect(meter).toHaveAttribute("aria-valuemax", "5")
    expect(meter).toHaveAttribute("aria-valuetext", "3 / 5 points")
    expect(fillFraction(meter)).toBe("0.6")
  })

  test("shows the count beside the label", () => {
    render(Meter, { props: { label: "Points", value: 1, max: 3 } })
    expect(screen.getByText("1 / 3 points")).toBeInTheDocument()
  })

  test("renders nothing when there is nothing to score", () => {
    const { container } = render(Meter, { props: { label: "Points", value: 0, max: 0 } })
    expect(container.firstElementChild).toBeNull()
  })

  test("clamps the fill to the track", () => {
    const { unmount } = render(Meter, { props: { label: "Over", value: 7, max: 4 } })
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "4")
    expect(fillFraction(screen.getByRole("meter"))).toBe("1")
    unmount()

    render(Meter, { props: { label: "Under", value: -2, max: 4 } })
    expect(fillFraction(screen.getByRole("meter"))).toBe("0")
  })
})
