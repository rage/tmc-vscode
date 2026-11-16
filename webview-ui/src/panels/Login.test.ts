import { fireEvent, render, screen } from "@testing-library/svelte"

import type { LoginPanel, LoginView } from "../../../shared/lib"
import { dispatchToWebview, postedMessages, replyToRequest } from "../test/setup"
import Login from "./Login.svelte"

const PANEL: LoginPanel = { id: 21, type: "Login", isAddingCourse: false }

const WAITING: LoginView = {
  phase: "waiting",
  userCode: "WXYZ-0001",
  verificationUrl: "https://courses.mooc.fi/oauth_device",
  expiresAt: "2026-11-16T10:15:00.000Z",
}

function sendView(view: LoginView): void {
  dispatchToWebview({ type: "loginView", target: { id: PANEL.id, type: PANEL.type }, view })
}

function loginAction(action: string): unknown {
  return { type: "loginAction", sourcePanel: { id: PANEL.id, type: PANEL.type }, action }
}

async function renderWaiting(): Promise<void> {
  render(Login, { props: { panel: PANEL } })
  sendView(WAITING)
  await screen.findByText("WXYZ-0001")
}

suite("the login screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-11-16T10:00:00Z"), toFake: ["Date"] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("waits for its code with Cancel only", async () => {
    render(Login, { props: { panel: PANEL } })

    expect(screen.getByRole("heading", { level: 1, name: "Log in to courses.mooc.fi" }))
    expect(screen.getByText("Getting a login code…")).toBeInTheDocument()
    await fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
    expect(postedMessages).toHaveBeenCalledWith(loginAction("cancel"))
    expect(screen.queryByRole("button", { name: /Open/ })).not.toBeInTheDocument()
  })

  test("shows the code, the page it is typed into and when it expires", async () => {
    await renderWaiting()

    expect(screen.getByText("Your login code")).toBeInTheDocument()
    expect(screen.getByText("https://courses.mooc.fi/oauth_device")).toBeInTheDocument()
    expect(screen.getByText("The code expires in 15 minutes.")).toBeInTheDocument()
    expect(screen.getByText("Waiting for you to approve the login in your browser.")).toBeVisible()
  })

  test("Open courses.mooc.fi is the one primary button, and asks the host to open the page", async () => {
    await renderWaiting()

    const open = screen.getByRole("button", { name: "Open courses.mooc.fi" })
    expect(open).not.toHaveAttribute("secondary")
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("secondary")
    expect(screen.getByRole("button", { name: "Copy" })).toHaveAttribute("secondary")
    await fireEvent.click(open)

    expect(postedMessages).toHaveBeenCalledWith(loginAction("openVerificationPage"))
  })

  test("copies the code through the host and says so", async () => {
    await renderWaiting()

    await fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(postedMessages).toHaveBeenCalledWith({
      type: "copyToClipboard",
      requestId: expect.any(Number),
      sourcePanel: { id: PANEL.id, type: PANEL.type },
      text: "WXYZ-0001",
    })
    replyToRequest("copyToClipboard", { ok: true })

    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument()
  })

  test("a failed copy says how to copy the code instead", async () => {
    await renderWaiting()

    await fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    replyToRequest("copyToClipboard", { ok: false, error: { message: "no clipboard" } })

    expect(
      await screen.findByText("Could not copy the code. Select it and copy it by hand."),
    ).toBeInTheDocument()
  })

  test("counts the expiry down by the minute", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-16T10:00:00Z") })
    await renderWaiting()

    await vi.advanceTimersByTimeAsync(14 * 60_000 + 15_000)
    expect(screen.getByText("The code expires in 1 minute.")).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(screen.getByText("The code has expired.")).toBeInTheDocument()
  })

  test.each([
    ["denied", "Login denied", "If you meant to approve it, try again for a new code."],
    ["expired", "Login code expired", "Try again for a new code."],
  ] as const)(
    "a %s login says what to do, and offers Try Again alone",
    async (failure, title, hint) => {
      render(Login, { props: { panel: PANEL } })
      sendView({ phase: "failed", failure, error: { message: "The sentence." } })

      expect(await screen.findByRole("heading", { level: 2, name: title })).toBeInTheDocument()
      expect(screen.getByText("The sentence.")).toBeInTheDocument()
      expect(screen.getByText(hint)).toBeInTheDocument()
      expect(screen.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([
        "Try Again",
      ])
      await fireEvent.click(screen.getByRole("button", { name: "Try Again" }))
      expect(postedMessages).toHaveBeenCalledWith(loginAction("tryAgain"))
    },
  )

  test("an unreachable server offers its details on the help screen", async () => {
    render(Login, { props: { panel: PANEL } })
    sendView({
      phase: "failed",
      failure: "unreachable",
      error: {
        message: "Could not reach courses.mooc.fi. Check your internet connection.",
        detailsId: "login-failure",
      },
    })

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Connection failed",
      }),
    ).toBeInTheDocument()
    await fireEvent.click(screen.getByRole("button", { name: "Show Details" }))
    expect(postedMessages).toHaveBeenCalledWith({
      type: "showErrorDetails",
      detailsId: "login-failure",
    })
  })

  test.each([
    ["serverError", "courses.mooc.fi ran into a problem"],
    ["other", "Login failed"],
  ] as const)("a %s failure is headed %s", async (failure, title) => {
    render(Login, { props: { panel: PANEL } })
    sendView({ phase: "failed", failure, error: { message: "Why." } })

    expect(await screen.findByRole("heading", { level: 2, name: title })).toBeInTheDocument()
  })

  test("says when the login is done", async () => {
    render(Login, { props: { panel: PANEL } })
    sendView({ phase: "loggedIn" })

    expect(await screen.findByRole("heading", { level: 2, name: "Logged in" })).toBeInTheDocument()
  })

  test("ignores another login's views", async () => {
    render(Login, { props: { panel: PANEL } })
    dispatchToWebview({
      type: "loginView",
      target: { id: PANEL.id + 1, type: "Login" },
      view: WAITING,
    })
    await Promise.resolve()

    expect(screen.queryByText("WXYZ-0001")).not.toBeInTheDocument()
  })
})
