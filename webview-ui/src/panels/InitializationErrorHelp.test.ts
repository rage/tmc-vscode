import { fireEvent, render, screen } from "@testing-library/svelte"

import { initializationErrorHelpPanel } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import InitializationErrorHelp from "./InitializationErrorHelp.svelte"

suite("InitializationErrorHelp panel", () => {
  test("renders the failure heading and asks the host for nothing", () => {
    render(InitializationErrorHelp, { props: { panel: initializationErrorHelpPanel() } })
    expect(
      screen.getByRole("heading", { name: "Initializing the extension failed" }),
    ).toBeInTheDocument()
    expect(postedMessages).not.toHaveBeenCalled()
  })

  test("renders a failure with the hint the host gave for it", () => {
    const panel = initializationErrorHelpPanel([
      { service: "tmc-langs", error: "langs boom", stack: "at foo", hint: "Check /tmp/cli." },
    ])
    render(InitializationErrorHelp, { props: { panel } })

    expect(screen.getByText(/Failed to initialize tmc-langs: langs boom/)).toBeInTheDocument()
    expect(screen.getByText("Check /tmp/cli.")).toBeInTheDocument()
  })

  test("reports a failure without also claiming there is no error data", () => {
    const panel = initializationErrorHelpPanel([
      { service: "workspace manager", error: "workspace boom", stack: "at bar" },
    ])
    render(InitializationErrorHelp, { props: { panel } })

    expect(
      screen.getByText(/Failed to initialize workspace manager: workspace boom/),
    ).toBeInTheDocument()
    expect(screen.queryByText("No error data found")).not.toBeInTheDocument()
  })

  test("shows the empty-state message when there are no failures", () => {
    render(InitializationErrorHelp, { props: { panel: initializationErrorHelpPanel() } })

    const empty = screen.getByText("No error data found")
    expect(empty.closest("ul")).toBeNull()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  test("lists each failure with its stack trace behind a disclosure", async () => {
    const panel = initializationErrorHelpPanel([
      { service: "user data", error: "userdata boom", stack: "at userData" },
      { service: "resources", error: "resources boom", stack: "at resources" },
    ])
    render(InitializationErrorHelp, { props: { panel } })

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

  test.each([
    ["Restart Extension Host", "workbench.action.restartExtensionHost"],
    ["Show Logs", "tmc.logs"],
    ["Report an Issue", "workbench.action.openIssueReporter"],
  ])("%s runs %s in the extension host", async (name, command) => {
    render(InitializationErrorHelp, { props: { panel: initializationErrorHelpPanel() } })
    ;(await screen.findByRole("button", { name })).click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "runCommand", command })
  })

  test("offers the log level setting in the overflow menu", async () => {
    render(InitializationErrorHelp, { props: { panel: initializationErrorHelpPanel() } })
    await fireEvent.click(screen.getByRole("button", { name: "More Actions" }))
    await fireEvent.click(await screen.findByRole("menuitem", { name: "Open Log Level Setting" }))
    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "workbench.action.openSettings",
    })
  })
})
