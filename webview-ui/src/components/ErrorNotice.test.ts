import { render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"

import { postedMessages } from "../test/setup"
import ErrorNotice from "./ErrorNotice.svelte"

suite("ErrorNotice component", () => {
  test("is an alert with the error's sentence and its details", () => {
    render(ErrorNotice, {
      props: { error: { message: "The CLI exited.", details: "exit code 1" } },
    })

    expect(screen.getByRole("alert")).toHaveTextContent("The CLI exited.")
    expect(screen.getByRole("group", { name: "Error details" })).toHaveTextContent("exit code 1")
  })

  test("offers each remedy as a button that runs its command in the host", async () => {
    render(ErrorNotice, {
      props: {
        error: {
          message: "Log in again to continue.",
          actions: [{ label: "Log in", command: "tmc.showMoocLogin" }],
        },
      },
    })

    ;(await screen.findByRole("button", { name: "Log in" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "tmc.showMoocLogin",
    })
  })

  test("puts the caller's actions after the remedies", async () => {
    render(ErrorNotice, {
      props: {
        error: {
          message: "Offline.",
          actions: [{ label: "Show help", command: "tmc.viewInitializationErrorHelp" }],
        },
        actions: createRawSnippet(() => ({ render: () => "<button>Retry</button>" })),
      },
    })

    const remedy = await screen.findByRole("button", { name: "Show help" })
    const retry = screen.getByRole("button", { name: "Retry" })
    expect(remedy.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
