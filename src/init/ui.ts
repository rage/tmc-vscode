import { Err, Ok, Result } from "ts-results"
import * as vscode from "vscode"

import { downloadOrUpdateExercises, refreshLocalExercises } from "../actions"
import type { ActionContext } from "../actions/types"
import { TmcPanel } from "../panels/TmcPanel"
import type { ExerciseIdentifier } from "../shared/shared"
import { CourseIdentifier, LocalCourseData } from "../shared/shared"
import type UI from "../ui/ui"
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

/**
 * Helper function that downloads exercises and creates the appropriate changes in the UI.
 */
export async function uiDownloadExercises(
  _ui: UI,
  actionContext: ActionContext,
  mode: string,
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): Promise<void> {
  const { userData } = actionContext
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  if (mode === "update") {
    TmcPanel.postMessage({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId,
      exerciseIds: [],
    })
    const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
    if (downloadResult.ok) {
      TmcPanel.postMessage({
        type: "setUpdateables",
        target: { type: "CourseDetails" },
        courseId,
        exerciseIds: downloadResult.val.failed,
      })
    }
    return
  }

  TmcPanel.postMessage({
    type: "setNewExercises",
    target: {
      type: "MyCourses",
    },
    courseId: courseId,
    exerciseIds: [],
  })

  const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
  if (downloadResult.err) {
    actionContext.dialog.errorNotification("Failed to download new exercises.", downloadResult.val)
    return
  }

  const refreshResult = Result.all(
    await userData.val.clearFromNewExercises(courseId, downloadResult.val.successful),
    await refreshLocalExercises(actionContext),
  )
  if (refreshResult.err) {
    actionContext.dialog.errorNotification("Failed to refresh local exercises.", refreshResult.val)
  }

  TmcPanel.postMessage({
    type: "setNewExercises",
    target: { type: "MyCourses" },
    courseId: courseId,
    exerciseIds: LocalCourseData.getNewExercises(userData.val.getCourse(courseId)),
  })
  // Per-exercise status is already posted by `downloadOrUpdateExercises` keyed by
  // the correct identifier (exercise id for both backends), so there is no need to
  // re-post a blanket "closed" for every input id here — doing so used to paper
  // over the mooc task-id/exercise-id key mismatch and would also wrongly mark
  // failed downloads as closed.
}
