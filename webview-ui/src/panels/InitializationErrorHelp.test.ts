import { render, screen } from "@testing-library/svelte"

import type { InitializationErrorHelpPanel } from "../shared/shared"
import { postedMessages } from "../test/setup"
import InitializationErrorHelp from "./InitializationErrorHelp.svelte"

const panel: InitializationErrorHelpPanel = { id: 4, type: "InitializationErrorHelp" }

const noError = null

suite("InitializationErrorHelp panel", () => {
  test("renders the failure heading and requests the errors on mount", () => {
    render(InitializationErrorHelp, { props: { panel } })
    expect(
      screen.getByRole("heading", { name: "Initializing the extension failed" }),
    ).toBeInTheDocument()
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestInitializationErrors",
      sourcePanel: panel,
    })
  })

  test("renders a specific initialization error once it arrives", async () => {
    render(InitializationErrorHelp, { props: { panel } })
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "initializationErrors",
          target: { type: "InitializationErrorHelp", id: panel.id },
          cliFolder: "/tmp/cli",
          initializationErrors: {
            tmc: { error: "langs boom", stack: "at foo" },
            userData: noError,
            workspaceManager: noError,
            exerciseDecorationProvider: noError,
            resources: noError,
          },
        },
      }),
    )

    expect(
      await screen.findByText(/Failed to initialize tmc-langs: langs boom/),
    ).toBeInTheDocument()
    expect(screen.getByText(/\/tmp\/cli/)).toBeInTheDocument()
  })
})
