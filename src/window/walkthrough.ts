import * as vscode from "vscode"

import { EXTENSION_ID } from "../config/constants"
import { trackContextKey } from "../ui/contextKeys"

/** The Get Started walkthrough; its last part must match the `walkthroughs` entry in package.json. */
export const WALKTHROUGH = `${EXTENSION_ID}#gettingStarted`

/**
 * The labels VS Code gives the tab of this walkthrough, before 1.137 and since; in another display
 * language they are not matched. The latter is also the Welcome page's, which may be replaced.
 */
const WALKTHROUGH_TAB_LABELS = ["Walkthrough: Get Started with TestMyCode", "Welcome"]

/** Whether `tab` may be this walkthrough: VS Code gives extensions no input for it. */
function isWalkthroughTab(tab: vscode.Tab | undefined): boolean {
  return tab !== undefined && WALKTHROUGH_TAB_LABELS.includes(tab.label) && tab.input === undefined
}

/**
 * Keeps `test-my-code:WalkthroughActive` true while the walkthrough may be the active tab.
 *
 * VS Code never completes an `onContext` step whose expression already holds when it registers
 * the walkthrough, which can be as late as its first showing. package.json pairs each such
 * expression with this key, still false then, so the pair turns true later and VS Code sees it.
 */
export function trackWalkthroughActive(): vscode.Disposable {
  return trackContextKey(
    "test-my-code:WalkthroughActive",
    () => isWalkthroughTab(vscode.window.tabGroups.activeTabGroup.activeTab),
    [vscode.window.tabGroups.onDidChangeTabs, vscode.window.tabGroups.onDidChangeTabGroups],
  )
}

/** What TestMyCode knows of the student's progress through the walkthrough. */
export interface WalkthroughProgress {
  isLoggedIn: boolean
  hasCourses: boolean
  hasDownloadedExercises: boolean
}

/**
 * The walkthrough step the student has yet to do, of the ones TestMyCode can tell are done; past
 * those, Run the tests. The ids are package.json's.
 */
export function nextWalkthroughStep(progress: WalkthroughProgress): string {
  if (!progress.isLoggedIn) {
    return "logIn"
  }
  if (!progress.hasCourses) {
    return "addCourse"
  }
  return progress.hasDownloadedExercises ? "runTests" : "openExercises"
}

/**
 * Moves the walkthrough a window reload restored onto the student's next step, if it is open.
 * VS Code restores it on the step it last showed, which in a window TestMyCode reloaded into a
 * course workspace is usually one already done. This brings it to the front of its group.
 */
export async function showNextWalkthroughStep(progress: WalkthroughProgress): Promise<void> {
  if (
    !vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => isWalkthroughTab(tab)))
  ) {
    return
  }
  await vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    // VS Code prefixes the step with the walkthrough itself.
    { category: WALKTHROUGH, step: nextWalkthroughStep(progress) },
    false,
  )
}
