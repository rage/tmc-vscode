import { fireEvent, render, screen, waitFor } from "@testing-library/svelte"

import type { MoocLoginPanel } from "../shared/shared"
import { findButton, getButton } from "../test/dom"
import { postedMessages } from "../test/setup"
import MoocLogin from "./MoocLogin.svelte"

const panel: MoocLoginPanel = {
  id: 7,
  type: "MoocLogin",
  requestingPanel: { id: 1, type: "MyCourses" },
}

const deviceCodeMessage = {
  type: "moocDeviceCode",
  target: { type: "MoocLogin", id: panel.id },
  userCode: "WXYZ-1234",
  verificationUri: "https://courses.mooc.fi/oauth_device",
  verificationUriComplete: "https://courses.mooc.fi/oauth_device?user_code=WXYZ-1234",
  expiresIn: 900,
  interval: 5,
}

const dispatch = (data: unknown): void => {
  window.dispatchEvent(new MessageEvent("message", { data }))
}

suite("MoocLogin panel", () => {
  test("starts the device-flow login on mount", () => {
    render(MoocLogin, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "moocLogin",
      sourcePanel: panel,
    })
  })

  test("shows the user code once the device code arrives", async () => {
    render(MoocLogin, { props: { panel } })
    dispatch(deviceCodeMessage)
    await waitFor(() => {
      expect(screen.getByText("WXYZ-1234")).toBeInTheDocument()
      expect(getButton("Open in browser")).toBeInTheDocument()
    })
  })

  test("Open in browser opens the complete verification URL", async () => {
    render(MoocLogin, { props: { panel } })
    dispatch(deviceCodeMessage)
    const button = await findButton("Open in browser")
    postedMessages.mockClear()
    await fireEvent.click(button)
    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: deviceCodeMessage.verificationUriComplete,
    })
  })

  test("Cancel interrupts the login", async () => {
    render(MoocLogin, { props: { panel } })
    dispatch(deviceCodeMessage)
    // Wait for the awaiting-state re-render so the Cancel button grabbed below is the live one.
    await screen.findByText("WXYZ-1234")
    const button = getButton("Cancel")
    postedMessages.mockClear()
    await fireEvent.click(button)
    expect(postedMessages).toHaveBeenCalledWith({
      type: "cancelMoocLogin",
      sourcePanel: { id: panel.id, type: panel.type },
    })
  })

  test("shows 'Copied' only after the clipboard write resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(MoocLogin, { props: { panel } })
    dispatch(deviceCodeMessage)
    const code = await screen.findByText("WXYZ-1234")
    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument()
    await fireEvent.click(code)
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("WXYZ-1234")
      expect(screen.getByText("Copied to clipboard")).toBeInTheDocument()
    })
  })

  test("does not show 'Copied' when the clipboard write rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })
    render(MoocLogin, { props: { panel } })
    dispatch(deviceCodeMessage)
    const code = await screen.findByText("WXYZ-1234")
    await fireEvent.click(code)
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    // Give any (incorrect) state update a chance to flush, then assert nothing.
    await Promise.resolve()
    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument()
  })

  test("does not show 'Copied' when the Clipboard API is absent", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })
    render(MoocLogin, { props: { panel } })
    dispatch(deviceCodeMessage)
    const code = await screen.findByText("WXYZ-1234")
    await fireEvent.click(code)
    await Promise.resolve()
    expect(screen.queryByText("Copied to clipboard")).not.toBeInTheDocument()
  })

  test("shows the error state on a moocLoginError message", async () => {
    render(MoocLogin, { props: { panel } })
    dispatch({
      type: "moocLoginError",
      target: { type: "MoocLogin", id: panel.id },
      error: "device flow expired",
    })
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("device flow expired")
      expect(getButton("Try again")).toBeInTheDocument()
    })
  })
})
