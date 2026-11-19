import { vi } from "vitest"
import * as vscode from "vscode"

import {
  hasReachedWalkthroughMilestone,
  isWalkthroughOpen,
  nextWalkthroughStep,
  reachWalkthroughMilestone,
  restoreWalkthroughMilestones,
  showNextWalkthroughStep,
  startWalkthroughRegistration,
  trackWalkthroughActive,
  WALKTHROUGH,
  whenWalkthroughRegistered,
} from "../../window/walkthrough"

function openTabs(...tabs: { label: string; input: unknown }[]): void {
  Object.defineProperty(vscode.window, "tabGroups", {
    value: { all: [{ tabs }] },
    configurable: true,
  })
}

suite("walkthrough", function () {
  const done = {
    canAddMoocCourses: false,
    isLoggedIn: true,
    hasCourses: true,
    hasDownloadedExercises: true,
    hasRunTests: true,
    hasSubmitted: true,
  }
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

  // With every step done VS Code would expand the first, Log In, whose button misleads.
  test("the next step is the first one not done, then Get Help", function () {
    expect(nextWalkthroughStep({ ...done, isLoggedIn: false })).toBe("logIn")
    expect(nextWalkthroughStep({ ...done, hasCourses: false })).toBe("addCourse")
    expect(nextWalkthroughStep({ ...done, hasCourses: false, canAddMoocCourses: true })).toBe(
      "addCourseWithCoursesMoocFi",
    )
    expect(nextWalkthroughStep({ ...done, hasDownloadedExercises: false })).toBe("openExercises")
    expect(nextWalkthroughStep({ ...done, hasRunTests: false })).toBe("runTests")
    expect(nextWalkthroughStep({ ...done, hasSubmitted: false })).toBe("submit")
    expect(nextWalkthroughStep(done)).toBe("getHelp")
  })

  test("counts the milestones reached as steps done", function () {
    const stored = new Map<string, unknown>()
    restoreWalkthroughMilestones({
      get: (key: string, fallback: unknown) => stored.get(key) ?? fallback,
      update: async (key: string, value: unknown) => void stored.set(key, value),
    } as unknown as vscode.Memento)
    expect(hasReachedWalkthroughMilestone("test-my-code:HasRunTests")).toBe(false)

    reachWalkthroughMilestone("test-my-code:HasRunTests")

    expect(hasReachedWalkthroughMilestone("test-my-code:HasRunTests")).toBe(true)
    expect(hasReachedWalkthroughMilestone("test-my-code:HasSubmitted")).toBe(false)
  })

  test("moves a restored walkthrough tab onto the next step, even behind another", async function () {
    openTabs({ label: "Welcome", input: undefined }, { label: "Python Course", input: {} })

    await showNextWalkthroughStep(() => done)

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.openWalkthrough",
      { category: WALKTHROUGH, step: "getHelp" },
      false,
    )
  })

  test("knows the walkthrough by the tab label VS Code 1.100 gives it", function () {
    openTabs({ label: "Walkthrough: TestMyCode", input: undefined })

    expect(isWalkthroughOpen()).toBe(true)
  })

  test("opens nothing when the walkthrough is not open", async function () {
    openTabs({ label: "main.py", input: { uri: vscode.Uri.file("/main.py") } })

    await showNextWalkthroughStep(() => done)

    expect(executeCommand).not.toHaveBeenCalled()
  })

  test("opens a closed walkthrough on the next step when asked to", async function () {
    openTabs({ label: "main.py", input: { uri: vscode.Uri.file("/main.py") } })

    await showNextWalkthroughStep(() => ({ ...done, hasDownloadedExercises: false }), {
      isOpenedIfClosed: true,
    })

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.openWalkthrough",
      { category: WALKTHROUGH, step: "openExercises" },
      false,
    )
  })

  test("has VS Code register the walkthrough, and says when it has", async function () {
    // From the epoch, so the wait is long over for the other tests.
    vi.useFakeTimers({ now: 0 })
    try {
      startWalkthroughRegistration()
      let isRegistered = false
      void whenWalkthroughRegistered().then(() => (isRegistered = true))

      await vi.advanceTimersByTimeAsync(5_000)
      expect(isRegistered).toBe(false)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(isRegistered).toBe(true)
      expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
        "welcome.markStepIncomplete",
        `${WALKTHROUGH}#registration`,
      )
    } finally {
      vi.useRealTimers()
    }
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

  test("sets a milestone reached in an earlier window again in the next", function () {
    const stored = new Map<string, unknown>()
    const store = {
      get: (key: string, fallback: unknown) => stored.get(key) ?? fallback,
      update: async (key: string, value: unknown) => void stored.set(key, value),
    } as unknown as vscode.Memento

    restoreWalkthroughMilestones(store)
    reachWalkthroughMilestone("test-my-code:HasRunTests")
    reachWalkthroughMilestone("test-my-code:HasRunTests")
    executeCommand.mockClear()
    restoreWalkthroughMilestones(store)

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      "setContext",
      "test-my-code:HasRunTests",
      true,
    )
  })
})
