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

  test("associates a visible label with the field via for/id", () => {
    const { container } = render(TextField, { props: { label: "Search courses" } })
    const labelEl = container.querySelector("vscode-label")
    const field = container.querySelector("vscode-textfield")
    expect(labelEl?.textContent?.trim()).toBe("Search courses")
    const forId = labelEl?.getAttribute("for")
    expect(forId).toBeTruthy()
    expect(field?.getAttribute("id")).toBe(forId)
  })

  test("renders no label element when no label is given", () => {
    const { container } = render(TextField, { props: { placeholder: "Search" } })
    expect(container.querySelector("vscode-label")).toBeNull()
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
