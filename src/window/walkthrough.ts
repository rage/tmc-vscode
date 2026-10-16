import * as vscode from "vscode"

import { EXTENSION_ID } from "../config/constants"

/** The Get Started walkthrough; its last part must match the `walkthroughs` entry in package.json. */
export const WALKTHROUGH = `${EXTENSION_ID}#gettingStarted`

/**
 * The labels VS Code gives the tab of this walkthrough, before 1.137 and since; in another display
 * language they are not matched. The latter is also the Welcome page's, which may be replaced.
 */
const WALKTHROUGH_TAB_LABELS = ["Walkthrough: Get Started with TestMyCode", "Welcome"]

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
 * Moves the walkthrough a window reload restored onto the student's next step, if it is the
 * active tab. VS Code restores it on the step it last showed, which in a window TestMyCode reloaded
 * into a course workspace is usually one already done.
 */
export async function showNextWalkthroughStep(progress: WalkthroughProgress): Promise<void> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab
  // A tab VS Code gives extensions no input for, unlike every editor of a file.
  if (!tab || !WALKTHROUGH_TAB_LABELS.includes(tab.label) || tab.input !== undefined) {
    return
  }
  await vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    // VS Code prefixes the step with the walkthrough itself.
    { category: WALKTHROUGH, step: nextWalkthroughStep(progress) },
    false,
  )
}
