import { vi } from "vitest"
import * as vscode from "vscode"

import Dialog from "../../api/dialog"

suite("Dialog.selectItem", function () {
  let showQuickPick: ReturnType<typeof vi.spyOn>

  function stubPick(choose: (picks: vscode.QuickPickItem[]) => unknown): void {
    showQuickPick = vi
      .spyOn(vscode.window, "showQuickPick")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((async (items: vscode.QuickPickItem[]) => choose(items)) as any)
  }

  afterEach(function () {
    showQuickPick.mockRestore()
  })

  test("passes the optional third tuple element through as the item description", async function () {
    stubPick(() => undefined)
    await new Dialog().selectItem(
      { title: "Add New Course", placeHolder: "Which course?" },
      ["Programming 1", "a", "TMC Server"],
      ["Programming 1", "b", "courses.mooc.fi"],
      ["No description", "c"],
    )

    expect(showQuickPick.mock.calls[0]?.[0]).toEqual([
      { label: "Programming 1", value: "a", description: "TMC Server" },
      { label: "Programming 1", value: "b", description: "courses.mooc.fi" },
      { label: "No description", value: "c" },
    ])
    expect(showQuickPick.mock.calls[0]?.[1]).toEqual({
      title: "Add New Course",
      placeHolder: "Which course?",
    })
  })

  test("resolves duplicate labels by the picked item, not by label equality", async function () {
    // Two courses can share a slug across backends; picking the second must not
    // silently yield the first.
    stubPick((items) => items[1])
    const picked = await new Dialog().selectItem(
      "Which course?",
      ["shared-slug", "tmc-course", "TMC Server"],
      ["shared-slug", "mooc-course", "courses.mooc.fi"],
    )
    expect(picked).toBe("mooc-course")
  })

  test("returns undefined when the pick is dismissed", async function () {
    stubPick(() => undefined)
    expect(await new Dialog().selectItem("Which course?", ["a", 1])).toBeUndefined()
  })
})

suite("Dialog.progressNotification", function () {
  let reports: { message?: string; increment?: number }[]

  beforeEach(function () {
    reports = []
    vi.spyOn(vscode.window, "withProgress").mockImplementation((async (
      _options: unknown,
      task: (
        progress: { report: (value: { message?: string; increment?: number }) => void },
        token: vscode.CancellationToken,
      ) => Promise<unknown>,
    ) =>
      task({ report: (value): void => void reports.push(value) }, {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: (): void => {} }),
      } as unknown as vscode.CancellationToken)) as unknown as typeof vscode.window.withProgress)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("delivers a message reported at an unchanged percentage", async function () {
    await new Dialog().progressNotification("Downloading", async (progress) => {
      progress.report({ message: "Fetching exercise 1", percent: 0.5 })
      progress.report({ message: "Fetching exercise 2", percent: 0.5 })
    })

    expect(reports).toEqual([
      { message: "Downloading", increment: 0 },
      { message: "Fetching exercise 1", increment: 50 },
      { message: "Fetching exercise 2", increment: 0 },
    ])
  })

  test("keeps the bar from moving backwards when the percentage drops", async function () {
    await new Dialog().progressNotification("Downloading", async (progress) => {
      progress.report({ message: "Exercise 1 done", percent: 0.6 })
      progress.report({ message: "Restarting exercise 2", percent: 0.2 })
      progress.report({ message: "Exercise 2 done", percent: 0.8 })
    })

    const increments = reports.map((report) => report.increment)
    expect(increments.slice(0, 3)).toEqual([0, 60, 0])
    expect(increments[3]).toBeCloseTo(20)
    expect(reports.at(-2)?.message).toBe("Restarting exercise 2")
  })

  test("drops a report that neither advances the bar nor carries a message", async function () {
    await new Dialog().progressNotification("Downloading", async (progress) => {
      progress.report({ percent: 0.4 })
      progress.report({ percent: 0.4 })
    })

    expect(reports).toEqual([{ message: "Downloading", increment: 0 }, { increment: 40 }])
  })
})
