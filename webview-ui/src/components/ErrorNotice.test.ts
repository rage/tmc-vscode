import { render, screen } from "@testing-library/svelte"
import { createRawSnippet } from "svelte"

import { postedMessages } from "../test/setup"
import ErrorNotice from "./ErrorNotice.svelte"

suite("ErrorNotice component", () => {
  test("is an alert with the error's sentence and nothing more", () => {
    render(ErrorNotice, { props: { error: { message: "The CLI exited." } } })

    expect(screen.getByRole("alert")).toHaveTextContent("The CLI exited.")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  test("opens the error's details on the host's help screen", async () => {
    render(ErrorNotice, { props: { error: { message: "The CLI exited.", detailsId: "d-1" } } })

    ;(await screen.findByRole("button", { name: "Show Details" })).click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "showErrorDetails", detailsId: "d-1" })
  })

  test("offers each remedy as a button that runs its command in the host", async () => {
    render(ErrorNotice, {
      props: {
        error: {
          message: "Log in again to continue.",
          actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
        },
      },
    })

    ;(await screen.findByRole("button", { name: "Log In" })).click()

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
          actions: [{ label: "Show Help", command: "tmc.viewInitializationErrorHelp" }],
        },
        actions: createRawSnippet(() => ({ render: () => "<button>Retry</button>" })),
      },
    })

    const remedy = await screen.findByRole("button", { name: "Show Help" })
    const retry = screen.getByRole("button", { name: "Retry" })
    expect(remedy.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test("puts Show Details last", async () => {
    render(ErrorNotice, {
      props: {
        error: { message: "Offline.", detailsId: "d-2" },
        actions: createRawSnippet(() => ({ render: () => "<button>Retry</button>" })),
      },
    })

    const details = await screen.findByRole("button", { name: "Show Details" })
    const retry = screen.getByRole("button", { name: "Retry" })
    expect(retry.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
