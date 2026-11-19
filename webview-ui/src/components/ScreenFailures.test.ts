import { fireEvent, render, screen } from "@testing-library/svelte"

import type { CourseDetailsPanel, ScreenFailure } from "../../../shared/lib"
import { makeTmcKind } from "../../../shared/lib"
import ScreenFailuresProbe from "../test/ScreenFailuresProbe.svelte"
import { dispatchToWebview, postedMessages, reloadDocument } from "../test/setup"
import { enterScreen } from "../utilities/uiState.svelte"

const PANEL: CourseDetailsPanel = {
  id: 8,
  type: "CourseDetails",
  courseId: makeTmcKind({ courseId: 42 }),
}

function fail(failure: ScreenFailure, panelId = PANEL.id): void {
  dispatchToWebview({
    type: "operationFailed",
    target: { id: panelId, type: "CourseDetails" },
    failure,
  })
}

const DOWNLOAD_FAILED: ScreenFailure = {
  serial: 1,
  tone: "error",
  title: "Failed to download the exercises.",
  operation: "Failed to download the exercises.",
  error: { message: "tmc.mooc.fi returned an error (500).", detailsId: "d-1" },
}

const BUSY: ScreenFailure = {
  serial: 2,
  tone: "warning",
  operation: "Failed to refresh the course.",
  error: { message: "A refresh is already in progress." },
}

function mount(isLogInShown = false): void {
  enterScreen(PANEL)
  render(ScreenFailuresProbe, { props: { panel: PANEL, isLogInShown } })
}

function clearFailures(operation?: string): void {
  dispatchToWebview({
    type: "failuresCleared",
    target: { id: PANEL.id, type: "CourseDetails" },
    ...(operation === undefined ? {} : { operation }),
  })
}

const LOGGED_OUT: ScreenFailure = {
  serial: 4,
  tone: "error",
  title: "Failed to download the exercise.",
  operation: "Failed to download the exercise.",
  error: {
    message: "You were logged out. Log in again.",
    actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
  },
}

suite("ScreenFailures", () => {
  test("shows each failure of its screen, newest last, an error as an alert", async () => {
    mount()
    fail(DOWNLOAD_FAILED)
    fail(BUSY)
    fail({ ...BUSY, serial: 3 }, 99)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Failed to download the exercises.")
    expect(alert).toHaveTextContent("tmc.mooc.fi returned an error (500).")
    expect(screen.getByRole("status")).toHaveTextContent("A refresh is already in progress.")
    expect(screen.getAllByText(/./, { selector: ".notice-title, p" }).at(-1)).toHaveTextContent(
      "A refresh is already in progress.",
    )
    expect(screen.getAllByRole("status")).toHaveLength(1)
  })

  test("offers a failure's details", async () => {
    mount()
    fail(DOWNLOAD_FAILED)

    await fireEvent.click(await screen.findByRole("button", { name: "Show Details" }))

    expect(postedMessages).toHaveBeenCalledWith({ type: "showErrorDetails", detailsId: "d-1" })
  })

  test("a dismissed failure stays dismissed when the host resends it to a reloaded document", async () => {
    mount()
    fail(DOWNLOAD_FAILED)
    await screen.findByRole("alert")
    const dismiss = document.querySelector('vscode-toolbar-button[title="Dismiss this error"]')
    await fireEvent.click(dismiss!)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    reloadDocument()
    mount()
    fail(DOWNLOAD_FAILED)
    fail(BUSY)

    expect(await screen.findByRole("status")).toHaveTextContent("A refresh is already in progress.")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  test("shows a failure resent before it was dismissed once", async () => {
    mount()
    fail(DOWNLOAD_FAILED)
    fail(DOWNLOAD_FAILED)

    expect(await screen.findAllByRole("alert")).toHaveLength(1)
  })

  test("a later failure of the same operation replaces the earlier one", async () => {
    mount()
    fail(DOWNLOAD_FAILED)
    fail({ ...DOWNLOAD_FAILED, serial: 5, error: { message: "Still failing." } })

    const alerts = await screen.findAllByRole("alert")
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent("Still failing.")
  })

  test("the host takes back the failures of one operation, or all of them", async () => {
    mount()
    fail(DOWNLOAD_FAILED)
    fail(BUSY)
    await screen.findByRole("alert")

    clearFailures(DOWNLOAD_FAILED.operation)
    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
    expect(screen.getByRole("status")).toHaveTextContent("A refresh is already in progress.")

    clearFailures()
    await vi.waitFor(() =>
      expect(screen.queryByText("A refresh is already in progress.")).not.toBeInTheDocument(),
    )
  })

  test("a failure the host took back stays gone when it is resent to a reloaded document", async () => {
    mount()
    fail(DOWNLOAD_FAILED)
    await screen.findByRole("alert")
    clearFailures()

    reloadDocument()
    mount()
    fail(DOWNLOAD_FAILED)

    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })

  test("leaves out a failure's Log In where the screen has its own", async () => {
    mount(true)
    fail(LOGGED_OUT)

    expect(await screen.findByRole("alert")).toHaveTextContent("You were logged out.")
    expect(screen.queryByRole("button", { name: "Log In" })).not.toBeInTheDocument()
  })
})
