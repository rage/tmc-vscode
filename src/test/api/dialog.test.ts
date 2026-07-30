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
