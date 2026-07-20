import { render } from "@testing-library/svelte"

import Card from "./Card.svelte"

suite("Card component", () => {
  test("renders a card container without crashing", () => {
    const { container } = render(Card)
    expect(container.querySelector(".card")).not.toBeNull()
  })
})
