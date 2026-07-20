import { fireEvent, render } from "@testing-library/svelte"
import { vi } from "vitest"

import TextField from "./TextField.svelte"

suite("TextField component", () => {
  test("renders a text field with the given placeholder", () => {
    const { container } = render(TextField, { props: { placeholder: "Search" } })
    const field = container.querySelector("vscode-textfield")
    expect(field).not.toBeNull()
    expect(field?.getAttribute("placeholder")).toBe("Search")
  })

  test("calls onChange with the current value on input", async () => {
    const onChange = vi.fn()
    const { container } = render(TextField, { props: { onChange } })

    const field = container.querySelector<HTMLInputElement>("vscode-textfield")
    expect(field).not.toBeNull()
    if (field) {
      field.value = "hello"
      await fireEvent.input(field)
    }

    expect(onChange).toHaveBeenLastCalledWith("hello")
  })
})
