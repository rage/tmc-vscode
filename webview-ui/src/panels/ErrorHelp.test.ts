import { fireEvent, render, screen } from "@testing-library/svelte"

import type { ErrorDetails } from "../../../shared/lib"
import { errorHelpPanel, startupHelpPanel } from "../test/fixtures"
import { postedMessages, replyToRequest } from "../test/setup"
import { withinShadowRoot } from "../test/shadow"
import ErrorHelp from "./ErrorHelp.svelte"

const DETAILS: ErrorDetails = {
  summary: "Failed to download the exercise. tmc.mooc.fi returned an error (500).",
  actions: [],
  causeChain: "Server Error: 500 from https://tmc.mooc.fi\n\nCaused by: Error: reset",
  occurredAt: "2026-10-01T09:00:00.000Z",
}

suite("ErrorHelp panel after a failed start", () => {
  test("renders the failure heading and asks the host only for the log", () => {
    render(ErrorHelp, { props: { panel: startupHelpPanel() } })
    expect(
      screen.getByRole("heading", { name: "Initializing the extension failed" }),
    ).toBeInTheDocument()
    expect(postedMessages.mock.calls.map(([message]) => message)).toEqual([
      {
        type: "requestLogTail",
        requestId: expect.any(Number),
        sourcePanel: { id: 4, type: "ErrorHelp" },
      },
    ])
  })

  test("renders a failure with the hint the host gave for it", () => {
    const panel = startupHelpPanel([
      { service: "tmc-langs", error: "langs boom", stack: "at foo", hint: "Check /tmp/cli." },
    ])
    render(ErrorHelp, { props: { panel } })

    expect(screen.getByText(/Failed to initialize tmc-langs: langs boom/)).toBeInTheDocument()
    expect(screen.getByText("Check /tmp/cli.")).toBeInTheDocument()
  })

  test("shows the empty-state message when there are no failures", () => {
    render(ErrorHelp, { props: { panel: startupHelpPanel() } })

    const empty = screen.getByText("No error data found")
    expect(empty.closest("ul")).toBeNull()
  })

  test("lists each failure with its stack trace behind a disclosure", async () => {
    const panel = startupHelpPanel([
      { service: "user data", error: "userdata boom", stack: "at userData" },
      { service: "resources", error: "resources boom", stack: "at resources" },
    ])
    render(ErrorHelp, { props: { panel } })

    const items = screen.getAllByRole("listitem")
    expect(items.map((item) => item.querySelector("p")?.textContent)).toEqual([
      "Failed to initialize user data: userdata boom",
      "Failed to initialize resources: resources boom",
    ])
    const toggle = screen.getByRole("button", { name: "Stack trace of resources" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    await fireEvent.click(toggle)
    expect(screen.getByRole("group", { name: "Stack trace of resources" })).toHaveTextContent(
      "at resources",
    )
  })

  test("shows the details a failure carries, such as the migration log", async () => {
    const panel = startupHelpPanel([
      {
        service: "user data",
        error: "migration failed",
        stack: "at migrate",
        details: "2026-11-19T10:00:00.000Z 3.5.5 -> 4.0.0: failed",
      },
    ])
    render(ErrorHelp, { props: { panel } })

    await fireEvent.click(screen.getByRole("button", { name: "Details of user data" }))
    expect(screen.getByRole("group", { name: "Details of user data" })).toHaveTextContent(
      "3.5.5 -> 4.0.0: failed",
    )
  })

  test.each([
    ["Restart Extension Host", "workbench.action.restartExtensionHost"],
    ["Show Logs", "tmc.logs"],
    ["Report an Issue", "workbench.action.openIssueReporter"],
  ])("%s runs %s in the extension host", async (name, command) => {
    render(ErrorHelp, { props: { panel: startupHelpPanel() } })
    ;(await screen.findByRole("button", { name })).click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "runCommand", command })
  })

  test("offers the log level setting in the overflow menu", async () => {
    render(ErrorHelp, { props: { panel: startupHelpPanel() } })
    await fireEvent.click(screen.getByRole("button", { name: "More Actions" }))
    await fireEvent.click(await screen.findByRole("menuitem", { name: "Open Log Level Setting" }))
    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "workbench.action.openSettings",
    })
  })
})

suite("ErrorHelp panel on one failure", () => {
  const panel = errorHelpPanel({ kind: "operation", detailsId: "d-1", details: DETAILS })

  test("heads the screen with the failure and shows its causes", () => {
    render(ErrorHelp, { props: { panel } })

    expect(screen.getByRole("heading", { level: 1, name: "Error Details" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 2, name: DETAILS.summary })).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Cause" })).toHaveTextContent(
      "Caused by: Error: reset",
    )
  })

  test("shows the log the host answers, and asks again on Refresh", async () => {
    render(ErrorHelp, { props: { panel } })
    replyToRequest("requestLogTail", { ok: true, value: "[ERROR] download failed" })

    expect(await screen.findByRole("group", { name: "Recent log" })).toHaveTextContent(
      "[ERROR] download failed",
    )
    postedMessages.mockClear()
    const refresh = await withinShadowRoot(screen.getByTitle("Refresh the log"))
    await fireEvent.click(refresh.getByRole("button"))
    expect(postedMessages).toHaveBeenCalledWith(expect.objectContaining({ type: "requestLogTail" }))
  })

  test("copies the failure, its causes and the log in one go", async () => {
    render(ErrorHelp, { props: { panel } })
    replyToRequest("requestLogTail", { ok: true, value: "[ERROR] download failed" })
    await screen.findByRole("group", { name: "Recent log" })

    await fireEvent.click(screen.getByRole("button", { name: "Copy Details" }))

    const copied = postedMessages.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "copyToClipboard")
    expect(copied).toMatchObject({ sourcePanel: { id: 4, type: "ErrorHelp" } })
    const text = (copied as { text: string }).text
    expect(text).toContain(DETAILS.summary)
    expect(text).toContain("Caused by: Error: reset")
    expect(text).toContain("[ERROR] download failed")
  })

  test("leads with Show Logs, Copy Details beside it", async () => {
    render(ErrorHelp, { props: { panel } })

    expect(await screen.findByRole("button", { name: "Show Logs" })).not.toHaveAttribute(
      "secondary",
    )
    expect(screen.getByRole("button", { name: "Copy Details" })).toHaveAttribute("secondary")
  })

  test("leads with the failure's remedy", async () => {
    render(ErrorHelp, {
      props: {
        panel: errorHelpPanel({
          kind: "operation",
          detailsId: "d-2",
          details: { ...DETAILS, actions: [{ label: "Log In", command: "tmc.showMoocLogin" }] },
        }),
      },
    })

    ;(await screen.findByRole("button", { name: "Log In" })).click()
    expect(screen.getByRole("button", { name: "Show Logs" })).toHaveAttribute("secondary")
    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "tmc.showMoocLogin",
    })
  })

  test("says the details are gone once the host no longer has them", async () => {
    render(ErrorHelp, {
      props: { panel: errorHelpPanel({ kind: "operation", detailsId: "d-3", details: null }) },
    })

    expect(screen.getByRole("heading", { name: "These details are gone" })).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Cause" })).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Show Logs" })).toBeInTheDocument()
  })
})

suite("ErrorHelp panel with no failure", () => {
  test("says what to try instead of claiming the start failed", () => {
    render(ErrorHelp, {
      props: {
        panel: errorHelpPanel({ kind: "general", hint: "Try an exception for /tmp/cli." }),
      },
    })

    expect(screen.queryByText(/Initializing the extension failed/)).not.toBeInTheDocument()
    expect(screen.getByText("Try an exception for /tmp/cli.")).toBeInTheDocument()
  })
})
