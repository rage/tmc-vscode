import { fireEvent, render, screen, waitFor } from "@testing-library/svelte"
import { vi } from "vitest"

import type { LoginPanel } from "../shared/shared"
import { postedMessages } from "../test/setup"
import Login from "./Login.svelte"

const panel: LoginPanel = { id: 1, type: "Login" }

suite("Login panel", () => {
  test("renders the login form", () => {
    render(Login, { props: { panel } })
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument()
    expect(screen.getByText(/Email or username/)).toBeInTheDocument()
  })

  test("requests its login data from the extension host on mount", () => {
    render(Login, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestLoginData",
      sourcePanel: panel,
    })
  })

  test("shows the error banner when a loginError message arrives", async () => {
    render(Login, { props: { panel } })

    // A schema-valid ExtensionToWebview message targeted at this panel.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "loginError",
          target: { type: "Login", id: panel.id },
          error: "Invalid credentials",
        },
      }),
    )

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials")
    })
  })

  test("posts a login message with the entered credentials on submit", async () => {
    const { container } = render(Login, { props: { panel } })
    postedMessages.mockClear()

    // Ids are generated via $props.id(), so fields are found by type; fire `input` after
    // setting `.value` since `bind:value` reads it on that event.
    const usernameField = container.querySelector<HTMLInputElement>('vscode-textfield[type="text"]')
    const passwordField = container.querySelector<HTMLInputElement>(
      'vscode-textfield[type="password"]',
    )
    expect(usernameField).not.toBeNull()
    expect(passwordField).not.toBeNull()
    if (usernameField) {
      usernameField.value = "test-user"
      await fireEvent.input(usernameField)
    }
    if (passwordField) {
      passwordField.value = "test-password"
      await fireEvent.input(passwordField)
    }

    const form = container.querySelector("form")
    expect(form).not.toBeNull()
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

    await waitFor(() => {
      expect(postedMessages).toHaveBeenCalledWith({
        type: "login",
        username: "test-user",
        password: "test-password",
        sourcePanel: panel,
      })
    })
  })

  test("removes its window message listener on unmount, avoiding leaks across navigation", () => {
    const addSpy = vi.spyOn(window, "addEventListener")
    const removeSpy = vi.spyOn(window, "removeEventListener")

    const { unmount } = render(Login, { props: { panel } })
    const messageCall = addSpy.mock.calls.find(([type]) => type === "message")
    expect(messageCall).toBeDefined()
    const [, handler] = messageCall ?? []

    unmount()

    expect(removeSpy).toHaveBeenCalledWith("message", handler)

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
