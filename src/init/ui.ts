import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { CourseIdentifier, LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities/"

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(actionContext: ActionContext): Result<void, Error> {
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

  if (userData.err) {
    return new Err(new Error("Extension was not initialized properly"))
  }

  if (
    !(
      userData.ok &&
      langs.ok &&
      resources.ok &&
      exerciseDecorationProvider.ok &&
      workspaceManager.ok
    )
  ) {
    // something failed
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

  // Register UI actions
  if (langs.ok) {
    // cannot login without tmc
    ui.treeDP.registerAction(
      "Log in",
      "logIn",
      [visibilityGroups.loggedIn.not],
      {
        command: "tmc.showLogin",
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

  return Ok.EMPTY
}
