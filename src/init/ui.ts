import type { ActionContext } from "../actions/types"
import { CourseIdentifier, LocalCourseData } from "../shared/shared"
import type { TreeEntryChild } from "../ui/treeview/treeview"
import { Logger } from "../utilities/"

/**
 * Fills the TestMyCode tree view with the entries the current initialization state can
 * offer, from the full menu down to the two recovery entries a broken activation leaves.
 *
 * Each entry id is registered from exactly one place here; registering one twice throws.
 * Call once per activation.
 */
export function registerUiActions(actionContext: ActionContext): void {
  const { ui, userData, langs, resources, exerciseDecorationProvider, workspaceManager } =
    actionContext
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
    ui.treeDP.registerAction({
      label: "View initialization error help",
      id: "tmc.viewInitializationErrorHelp",
      visible: "always",
      command: {
        command: "tmc.viewInitializationErrorHelp",
        title: "Open help message for the extension initialization error",
      },
      iconId: "warning",
    })
    ui.treeDP.registerAction({
      label: "Restart extension host",
      id: "workbench.action.restartExtensionHost",
      visible: "always",
      command: {
        command: "workbench.action.restartExtensionHost",
        title: "Restart extension host",
      },
      iconId: "debug-restart",
    })
  }

  if (langs.ok) {
    ui.treeDP.registerAction({
      label: "Log in",
      id: "logIn",
      visible: "loggedOut",
      command: {
        command: "tmc.showMoocLogin",
        title: "",
        arguments: [],
      },
      iconId: "sign-in",
    })
  }

  if (userData.ok) {
    ui.treeDP.registerAction({
      label: "My Courses",
      id: "myCourses",
      visible: "loggedIn",
      command: {
        command: "tmc.myCourses",
        title: "Go to My Courses",
      },
      children: (): TreeEntryChild[] =>
        userData.val.getCourses().map((course) => ({
          label: LocalCourseData.getCourseTitle(course),
          id: CourseIdentifier.toString(LocalCourseData.getCourseId(course)),
          command: {
            command: "tmc.courseDetails",
            title: "Go to course details",
            arguments: [LocalCourseData.getCourseId(course)],
          },
        })),
      iconId: "book",
    })
  }

  ui.treeDP.registerAction({
    label: "Settings",
    id: "settings",
    visible: "always",
    command: {
      command: "tmc.settings",
      title: "Open TestMyCode settings",
    },
    iconId: "settings-gear",
  })
  // Label is backend-neutral: the folder holds both tmc and mooc exercises.
  ui.treeDP.registerAction({
    label: "Open Exercises Folder",
    id: "tmcDataFolder",
    visible: "always",
    command: {
      command: "tmc.openTMCExercisesFolder",
      title: "Open Exercises Folder",
    },
    iconId: "folder-opened",
  })
  ui.treeDP.registerAction({
    label: "Show Extension Logs",
    id: "logs",
    visible: "always",
    command: {
      command: "tmc.logs",
      title: "Show Extension Logs",
    },
    iconId: "output",
  })
  ui.treeDP.registerAction({
    label: "Log out",
    id: "logOut",
    visible: "loggedIn",
    command: {
      command: "tmc.logout",
      title: "Log out",
    },
    iconId: "sign-out",
  })
}
