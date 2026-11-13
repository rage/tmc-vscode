import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { EXTENSION_ID } from "../config/constants"
import { trackContextKey } from "../ui/contextKeys"

/** The Get Started walkthrough; its last part must match the `walkthroughs` entry in package.json. */
export const WALKTHROUGH = `${EXTENSION_ID}#gettingStarted`

/**
 * The labels VS Code gives the tab of this walkthrough across versions, 1.100 naming the
 * extension; in another display language they are not matched. "Welcome" is also the Welcome
 * page's, which may be replaced.
 */
const WALKTHROUGH_TAB_LABELS = [
  "Walkthrough: TestMyCode",
  "Walkthrough: Get Started with TestMyCode",
  "Welcome",
]

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

/** Whether the walkthrough is open in any tab of this window, shown or not. */
export function isWalkthroughOpen(): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => isWalkthroughTab(tab)),
  )
}

/** The student's progress as this activation sees it. */
export function walkthroughProgressOf({
  authState,
  startup,
}: Pick<ReadyActionContext, "authState" | "startup">): WalkthroughProgress {
  return {
    isLoggedIn: authState.loggedIn,
    hasCourses: startup.userData.getCourses().length > 0,
    hasDownloadedExercises: startup.workspaceManager.getExercises().length > 0,
  }
}

/**
 * Moves the walkthrough onto the student's next step, if it is open. VS Code leaves it on the
 * step it last showed, which after a step done outside it, or in a window TestMyCode reloaded
 * into a course workspace, is usually one already done. This brings it to the front of its group.
 *
 * @param progress Read only when the walkthrough is to be shown.
 * @param isOpenedIfClosed Opens it even when closed, for a window that replaced one showing it.
 */
export async function showNextWalkthroughStep(
  progress: () => WalkthroughProgress,
  { isOpenedIfClosed = false }: { isOpenedIfClosed?: boolean } = {},
): Promise<void> {
  if (!isOpenedIfClosed && !isWalkthroughOpen()) {
    return
  }
  await vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    // VS Code prefixes the step with the walkthrough itself.
    { category: WALKTHROUGH, step: nextWalkthroughStep(progress()) },
    false,
  )
}
