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
  error: { message: "tmc.mooc.fi returned an error (500).", detailsId: "d-1" },
}

const BUSY: ScreenFailure = {
  serial: 2,
  tone: "warning",
  error: { message: "A refresh is already in progress." },
}

function mount(): void {
  enterScreen(PANEL)
  render(ScreenFailuresProbe, { props: { panel: PANEL } })
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
})
