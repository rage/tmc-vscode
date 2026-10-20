import { vi } from "vitest"
import * as vscode from "vscode"

import {
  nextWalkthroughStep,
  showNextWalkthroughStep,
  trackWalkthroughActive,
  WALKTHROUGH,
} from "../../window/walkthrough"

function openTabs(...tabs: { label: string; input: unknown }[]): void {
  Object.defineProperty(vscode.window, "tabGroups", {
    value: { all: [{ tabs }] },
    configurable: true,
  })
}

suite("walkthrough", function () {
  const done = { isLoggedIn: true, hasCourses: true, hasDownloadedExercises: true }
  let executeCommand: ReturnType<typeof vi.spyOn>
  const initialTabGroups = vscode.window.tabGroups

  beforeEach(function () {
    executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
  })

  afterEach(function () {
    Object.defineProperty(vscode.window, "tabGroups", {
      value: initialTabGroups,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  test("the next step is the first one not done, then Run the tests", function () {
    expect(nextWalkthroughStep({ ...done, isLoggedIn: false })).toBe("logIn")
    expect(nextWalkthroughStep({ ...done, hasCourses: false })).toBe("addCourse")
    expect(nextWalkthroughStep({ ...done, hasDownloadedExercises: false })).toBe("openExercises")
    expect(nextWalkthroughStep(done)).toBe("runTests")
  })

  test("moves a restored walkthrough tab onto the next step, even behind another", async function () {
    openTabs({ label: "Welcome", input: undefined }, { label: "Python Course", input: {} })

    await showNextWalkthroughStep(done)

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.openWalkthrough",
      { category: WALKTHROUGH, step: "runTests" },
      false,
    )
  })

  test("opens nothing when the walkthrough is not open", async function () {
    openTabs({ label: "main.py", input: { uri: vscode.Uri.file("/main.py") } })

    await showNextWalkthroughStep(done)

    expect(executeCommand).not.toHaveBeenCalled()
  })

  test("says whether the walkthrough is the active tab, as the tabs change", function () {
    const tabsChanged = new vscode.EventEmitter<unknown>()
    const tabGroups = {
      activeTabGroup: { activeTab: { label: "main.py", input: {} } as unknown },
      onDidChangeTabs: tabsChanged.event,
      onDidChangeTabGroups: new vscode.EventEmitter<unknown>().event,
    }
    Object.defineProperty(vscode.window, "tabGroups", { value: tabGroups, configurable: true })

    const tracking = trackWalkthroughActive()
    tabGroups.activeTabGroup.activeTab = { label: "Welcome", input: undefined }
    tabsChanged.fire(undefined)
    tracking.dispose()

    expect(executeCommand.mock.calls).toEqual([
      ["setContext", "test-my-code:WalkthroughActive", false],
      ["setContext", "test-my-code:WalkthroughActive", true],
    ])
  })
})
