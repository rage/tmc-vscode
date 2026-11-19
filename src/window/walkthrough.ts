import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { EXTENSION_ID } from "../config/constants"
import { trackContextKey } from "../ui/contextKeys"
import { Logger } from "../utilities"

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

/**
 * A walkthrough step done by an action with ways in that VS Code's `onCommand` completion does
 * not see, such as a notification button or the Testing view; package.json completes the step
 * on its key.
 */
export type WalkthroughMilestone = "test-my-code:HasRunTests" | "test-my-code:HasSubmitted"

const MILESTONES_KEY = "walkthroughMilestones"

/** Where milestones outlive the window; unset before {@link restoreWalkthroughMilestones}. */
let milestoneStore: vscode.Memento | undefined

function setMilestoneKey(milestone: WalkthroughMilestone): void {
  void Promise.resolve(vscode.commands.executeCommand("setContext", milestone, true)).catch((e) =>
    Logger.warn(`Could not set ${milestone}`, e),
  )
}

/**
 * Sets the milestones reached in earlier windows again, and keeps later ones in `store`.
 *
 * A context key lasts one window, and opening a course workspace opens another: a step done
 * there before VS Code registered the walkthrough completes only once the key is set as its
 * walkthrough tab shows, which `test-my-code:WalkthroughActive` pairs it with.
 */
export function restoreWalkthroughMilestones(store: vscode.Memento): void {
  milestoneStore = store
  for (const milestone of store.get<WalkthroughMilestone[]>(MILESTONES_KEY, [])) {
    setMilestoneKey(milestone)
  }
}

/** Completes the walkthrough step that `milestone` stands for, in this window and later ones. */
export function reachWalkthroughMilestone(milestone: WalkthroughMilestone): void {
  setMilestoneKey(milestone)
  const reached = milestoneStore?.get<WalkthroughMilestone[]>(MILESTONES_KEY, []) ?? []
  if (milestoneStore && !reached.includes(milestone)) {
    void Promise.resolve(milestoneStore.update(MILESTONES_KEY, [...reached, milestone])).catch(
      (e) => Logger.warn(`Could not store ${milestone}`, e),
    )
  }
}

/** Whether `milestone` was reached in this window or an earlier one. */
export function hasReachedWalkthroughMilestone(milestone: WalkthroughMilestone): boolean {
  return (
    milestoneStore?.get<WalkthroughMilestone[]>(MILESTONES_KEY, []).includes(milestone) ?? false
  )
}

/** What TestMyCode knows of the student's progress through the walkthrough. */
export interface WalkthroughProgress {
  /** Picks the Add Course step's variant, which package.json shows by the setting. */
  canAddMoocCourses: boolean
  isLoggedIn: boolean
  hasCourses: boolean
  hasDownloadedExercises: boolean
  hasRunTests: boolean
  hasSubmitted: boolean
}

/**
 * The walkthrough step the student has yet to do; past those, Get Help, which is done once shown.
 * The ids are package.json's.
 *
 * Opened on no step, VS Code expands the first not done, and with every step done the first of
 * all, Log In, whose button then misleads a student logged in.
 */
export function nextWalkthroughStep(progress: WalkthroughProgress): string {
  if (!progress.isLoggedIn) {
    return "logIn"
  }
  if (!progress.hasCourses) {
    return progress.canAddMoocCourses ? "addCourseWithCoursesMoocFi" : "addCourse"
  }
  if (!progress.hasDownloadedExercises) {
    return "openExercises"
  }
  if (!progress.hasRunTests) {
    return "runTests"
  }
  return progress.hasSubmitted ? "getHelp" : "submit"
}

/** Whether the walkthrough is open in any tab of this window, shown or not. */
export function isWalkthroughOpen(): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => isWalkthroughTab(tab)),
  )
}

/** Whether the walkthrough is the shown tab of some editor group. */
export function isWalkthroughVisible(): boolean {
  return vscode.window.tabGroups.all.some((group) => isWalkthroughTab(group.activeTab))
}

/** The student's progress as this activation sees it. */
export function walkthroughProgressOf({
  authState,
  settings,
  startup,
}: Pick<ReadyActionContext, "authState" | "settings" | "startup">): WalkthroughProgress {
  return {
    canAddMoocCourses: settings.isCoursesMoocFiEnabled(),
    isLoggedIn: authState.loggedIn,
    hasCourses: startup.userData.getCourses().length > 0,
    hasDownloadedExercises: startup.workspaceManager.getExercises().length > 0,
    hasRunTests: hasReachedWalkthroughMilestone("test-my-code:HasRunTests"),
    hasSubmitted: hasReachedWalkthroughMilestone("test-my-code:HasSubmitted"),
  }
}

/**
 * Moves the walkthrough onto the student's next step, if it is open. VS Code leaves it on the
 * step it last showed, which after a step done outside it, or in a window TestMyCode reloaded
 * into a course workspace, is usually one already done. This brings it to the front of its group.
 *
 * @param progress Read only when the walkthrough is to be shown.
 * @param isOpenedIfClosed Opens it even when closed, for a window that replaced one showing it.
 * @param isVisibleOnly Moves it only when it is already shown, so it never covers what the
 * student has in front of it.
 */
export async function showNextWalkthroughStep(
  progress: () => WalkthroughProgress,
  {
    isOpenedIfClosed = false,
    isVisibleOnly = false,
  }: { isOpenedIfClosed?: boolean; isVisibleOnly?: boolean } = {},
): Promise<void> {
  if (isVisibleOnly ? !isWalkthroughVisible() : !isOpenedIfClosed && !isWalkthroughOpen()) {
    return
  }
  await vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    // VS Code prefixes the step with the walkthrough itself.
    { category: WALKTHROUGH, step: nextWalkthroughStep(progress()) },
    false,
  )
}
