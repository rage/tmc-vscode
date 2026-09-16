import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { CourseIdentifier, LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities/"

/**
 * Fills the TestMyCode tree view with the entries the current initialization state can
 * offer, from the full menu down to the two recovery entries a broken activation leaves.
 *
 * Each entry id is registered from exactly one place here; registering one twice throws.
 * Call once per activation.
 */
export function registerUiActions(actionContext: ActionContext): void {
  const {
    ui,
    visibilityGroups,
    userData,
    langs,
    resources,
    exerciseDecorationProvider,
    workspaceManager,
  } = actionContext
  Logger.info("Initializing UI Actions")

  if (
    !(
      userData.ok &&
      langs.ok &&
      resources.ok &&
      exerciseDecorationProvider.ok &&
      workspaceManager.ok
    )
  ) {
    ui.treeDP.registerAction(
      "View initialization error help",
      "tmc.viewInitializationErrorHelp",
      [],
      {
        command: "tmc.viewInitializationErrorHelp",
        title: "Open help message for the extension initialization error",
      },
      undefined,
      undefined,
      "warning",
    )
    ui.treeDP.registerAction(
      "Restart extension host",
      "workbench.action.restartExtensionHost",
      [],
      { command: "workbench.action.restartExtensionHost", title: "Restart extension host" },
      undefined,
      undefined,
      "debug-restart",
    )
  }

  if (langs.ok) {
    ui.treeDP.registerAction(
      "Log in",
      "logIn",
      [visibilityGroups.loggedIn.not],
      {
        command: "tmc.showMoocLogin",
        title: "",
        arguments: [],
      },
      undefined,
      undefined,
      "sign-in",
    )
  }

  if (userData.ok) {
    const userCourses = userData.val.getCourses()
    ui.treeDP.registerAction(
      "My Courses",
      "myCourses",
      [visibilityGroups.loggedIn],
      {
        command: "tmc.myCourses",
        title: "Go to My Courses",
      },
      userCourses.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      userCourses.map<{ label: string; id: string; command: vscode.Command }>((course) => ({
        label: LocalCourseData.getCourseName(course),
        id: CourseIdentifier.toString(LocalCourseData.getCourseId(course)),
        command: {
          command: "tmc.courseDetails",
          title: "Go to course details",
          arguments: [LocalCourseData.getCourseId(course)],
        },
      })),
      "book",
    )
  }

  ui.treeDP.registerAction(
    "Settings",
    "settings",
    [],
    {
      command: "tmc.settings",
      title: "Open TestMyCode settings",
    },
    undefined,
    undefined,
    "settings-gear",
  )
  // Label is backend-neutral: the folder holds both tmc and mooc exercises.
  ui.treeDP.registerAction(
    "Open Exercises Folder",
    "tmcDataFolder",
    [],
    {
      command: "tmc.openTMCExercisesFolder",
      title: "Open Exercises Folder",
    },
    undefined,
    undefined,
    "folder-opened",
  )
  ui.treeDP.registerAction(
    "Show Extension Logs",
    "logs",
    [],
    {
      command: "tmc.logs",
      title: "Show Extension Logs",
    },
    undefined,
    undefined,
    "output",
  )
  ui.treeDP.registerAction(
    "Log out",
    "logOut",
    [visibilityGroups.loggedIn],
    {
      command: "tmc.logout",
      title: "Log out",
    },
    undefined,
    undefined,
    "sign-out",
  )
}
