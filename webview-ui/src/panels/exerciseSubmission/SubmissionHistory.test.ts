import { render, screen, within } from "@testing-library/svelte"
import { tick } from "svelte"

import type { SubmissionHistoryEntry } from "../../../../shared/lib"
import { dispatchToWebview, postedMessages, replyToRequest } from "../../test/setup"
import SubmissionHistory from "./SubmissionHistory.svelte"

const sourcePanel = { id: 4, type: "ExerciseSubmission" } as const

function entry(overrides: Partial<SubmissionHistoryEntry> = {}): SubmissionHistoryEntry {
  return {
    key: "sub-1",
    createdAt: "2026-09-30T10:00:00Z",
    dateLabel: "Sep 30, 2026, 1:00:00 PM",
    kind: "submission",
    points: { given: 1, max: 2 },
    status: "Some tests failed",
    isPassed: false,
    isNewestGraded: false,
    isShared: false,
    ...overrides,
  }
}

const passed = entry({
  key: "sub-2",
  createdAt: "2026-09-30T11:00:00Z",
  dateLabel: "Sep 30, 2026, 2:00:00 PM",
  points: { given: 2, max: 2 },
  status: "Passed",
  isPassed: true,
  isNewestGraded: true,
})
const backup = entry({
  key: "backup-1",
  kind: "backup",
  points: undefined,
  status: "Not graded",
  dateLabel: "Sep 30, 2026, 3:00:00 PM",
})
const helpRequest = entry({
  key: "paste-1",
  kind: "paste",
  points: undefined,
  status: "Not graded",
  isShared: true,
  dateLabel: "Sep 30, 2026, 4:00:00 PM",
})

function listWith(entries: SubmissionHistoryEntry[]): void {
  replyToRequest("requestSubmissionHistory", { ok: true, value: entries })
}

function rowTexts(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => (item.textContent ?? "").replaceAll(/\s+/g, " ").trim())
}

/** The host's word that the student confirmed restoring `key`. */
function confirmRestore(key: string): void {
  dispatchToWebview({ type: "restoreConfirmed", target: sourcePanel, key })
}

suite("SubmissionHistory component", () => {
  test("asks the host for the history of the exercise the panel shows", () => {
    render(SubmissionHistory, { props: { sourcePanel } })

    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestSubmissionHistory",
      requestId: expect.any(Number),
      sourcePanel,
    })
    expect(screen.getByText("Loading submissions…")).toBeInTheDocument()
  })

  test("lists each entry's date, kind, score out of the maximum and outcome, marking the latest", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([passed, entry()])

    await screen.findByText("Latest submission")
    expect(rowTexts()).toEqual([
      "Sep 30, 2026, 2:00:00 PM Latest submission Submission · 2 / 2 points · Passed Restore",
      "Sep 30, 2026, 1:00:00 PM Submission · 1 / 2 points · Some tests failed Restore",
    ])
    expect(screen.getAllByRole("listitem")[0]?.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-09-30T11:00:00Z",
    )
  })

  test("groups help requests and backups after the submissions, saying what is shared", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([passed, helpRequest, backup])

    expect(await screen.findByRole("heading", { name: "Submissions" })).toBeInTheDocument()
    const ungraded = screen.getByRole("heading", { name: "Help requests and backups" })
    const list = ungraded.nextElementSibling as HTMLElement
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => (item.textContent ?? "").replaceAll(/\s+/g, " ").trim()),
    ).toEqual([
      "Sep 30, 2026, 4:00:00 PM Help request · Not graded · Shared Restore",
      "Sep 30, 2026, 3:00:00 PM Backup · Not graded Restore",
    ])
  })

  test("names each Restore by the entry it restores", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([passed, backup])

    expect(
      await screen.findByRole("button", {
        name: "Restore the backup from Sep 30, 2026, 3:00:00 PM",
      }),
    ).toBeInTheDocument()
  })

  test("says when there is nothing to restore", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([])

    expect(await screen.findByText("No earlier submissions yet.")).toBeInTheDocument()
  })

  test("restores through the host, which asks first, and lists again after it", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([passed])
    const restore = await screen.findByRole("button", { name: /^Restore the submission/ })
    postedMessages.mockClear()

    restore.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "restoreSubmission",
      requestId: expect.any(Number),
      sourcePanel,
      key: "sub-2",
    })
    // The host asks first in a modal; until the answer the restore has not begun.
    await tick()
    expect(screen.queryByText("Restoring…")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Restore the submission/ })).toHaveAttribute(
      "disabled",
    )
    confirmRestore("sub-2")
    expect(await screen.findByText("Restoring…")).toBeInTheDocument()
    replyToRequest("restoreSubmission", { ok: true, value: "restored" })
    expect(
      await screen.findByText("Restored the submission from Sep 30, 2026, 2:00:00 PM."),
    ).toBeInTheDocument()
    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ type: "requestSubmissionHistory" }),
    )
  })

  test("a cancelled restore leaves the list as it was", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([passed])
    ;(await screen.findByRole("button", { name: /^Restore the submission/ })).click()

    replyToRequest("restoreSubmission", { ok: true, value: "cancelled" })

    expect(
      await screen.findByRole("button", { name: /^Restore the submission/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Restored/)).not.toBeInTheDocument()
    expect(
      postedMessages.mock.calls.filter(([message]) => message.type === "requestSubmissionHistory"),
    ).toHaveLength(1)
  })

  test("says when the entry had no files to download", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([passed])
    ;(await screen.findByRole("button", { name: /^Restore the submission/ })).click()

    replyToRequest("restoreSubmission", { ok: true, value: "nothingToDownload" })

    expect(await screen.findByText("That submission has no files to download.")).toBeInTheDocument()
  })

  test("a failed restore says why", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    listWith([passed])
    ;(await screen.findByRole("button", { name: /^Restore the submission/ })).click()

    replyToRequest("restoreSubmission", { ok: false, error: { message: "Disk full." } })

    expect(await screen.findByText("Could not restore the submission")).toBeInTheDocument()
    expect(screen.getByText("Disk full.")).toBeInTheDocument()
  })

  test("a failed listing says why and can be tried again", async () => {
    render(SubmissionHistory, { props: { sourcePanel } })
    replyToRequest("requestSubmissionHistory", { ok: false, error: { message: "Offline." } })
    const retry = await screen.findByRole("button", { name: "Try Again" })
    postedMessages.mockClear()

    retry.click()

    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ type: "requestSubmissionHistory" }),
    )
  })

  test("lists without Restore, saying why, when nothing can be restored now", async () => {
    render(SubmissionHistory, {
      props: { sourcePanel, restoreRefusal: "Open the exercise again to restore a submission." },
    })
    listWith([passed])

    await screen.findByText("Latest submission")
    expect(screen.getByText("Open the exercise again to restore a submission.")).toBeVisible()
    expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument()
  })
})
