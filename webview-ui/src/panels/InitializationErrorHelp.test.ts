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

  test("renders a specific initialization error with the CLI folder hint", () => {
    const panel = initializationErrorHelpPanel({ tmc: { error: "langs boom", stack: "at foo" } })
    render(InitializationErrorHelp, { props: { panel } })

    expect(screen.getByText(/Failed to initialize tmc-langs: langs boom/)).toBeInTheDocument()
    expect(screen.getByText(/\/tmp\/cli/)).toBeInTheDocument()
  })

  test("reports a non-tmc error without also claiming there is no error data", () => {
    const panel = initializationErrorHelpPanel({
      workspaceManager: { error: "workspace boom", stack: "at bar" },
    })
    render(InitializationErrorHelp, { props: { panel } })

    expect(
      screen.getByText(/Failed to initialize workspace manager: workspace boom/),
    ).toBeInTheDocument()
    // the guard must not contradict itself and print the empty-state message too
    expect(screen.queryByText("No error data found")).not.toBeInTheDocument()
  })

  test("shows the empty-state message only when every error is null", () => {
    render(InitializationErrorHelp, { props: { panel: initializationErrorHelpPanel() } })

    const empty = screen.getByText("No error data found")
    expect(empty.closest("ul")).toBeNull()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  test("lists each failure with its stack trace behind a disclosure", async () => {
    const panel = initializationErrorHelpPanel({
      userData: { error: "userdata boom", stack: "at userData" },
      resources: { error: "resources boom", stack: "at resources" },
    })
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
    ["Restart extension host", "workbench.action.restartExtensionHost"],
    ["Show logs", "tmc.logs"],
    ["Open log level setting", "workbench.action.openSettings"],
    ["Report an issue", "workbench.action.openIssueReporter"],
  ])("%s runs %s in the extension host", async (name, command) => {
    render(InitializationErrorHelp, { props: { panel: initializationErrorHelpPanel() } })
    ;(await screen.findByRole("button", { name })).click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "runCommand", command })
  })
})
