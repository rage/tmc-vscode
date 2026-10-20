import { vi } from "vitest"
import * as vscode from "vscode"

import {
  nextWalkthroughStep,
  showNextWalkthroughStep,
  trackWalkthroughActive,
  WALKTHROUGH,
} from "../../window/walkthrough"

function activeTab(tab: { label: string; input: unknown } | undefined): void {
  Object.defineProperty(vscode.window, "tabGroups", {
    value: { activeTabGroup: { activeTab: tab } },
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

  test("moves a restored walkthrough tab onto the next step", async function () {
    activeTab({ label: "Welcome", input: undefined })

    await showNextWalkthroughStep(done)

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.openWalkthrough",
      { category: WALKTHROUGH, step: "runTests" },
      false,
    )
  })

  test("opens nothing over another editor", async function () {
    activeTab({ label: "main.py", input: { uri: vscode.Uri.file("/main.py") } })

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
