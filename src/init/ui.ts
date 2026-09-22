import type { ActionContext, Startup } from "../actions/types"
import { courseSelectionItems } from "../api/dialog"
import { CourseIdentifier } from "../shared/shared"
import type { TreeEntry, TreeEntryChild } from "../ui/treeview/treeview"
import { Logger } from "../utilities"

/**
 * Fills the TestMyCode tree view with the entries the current initialization state can
 * offer, from the full menu down to the two recovery entries a broken activation leaves.
 *
 * Each entry id is registered from exactly one place here; registering one twice throws.
 * Call once per activation.
 */
export function registerUiActions(actionContext: ActionContext): void {
  const { ui, startup } = actionContext
  Logger.info("Initializing UI Actions")

  for (const entry of treeEntries(startup)) {
    ui.treeDP.registerAction(entry)
  }
}

/**
 * The menu one startup state can stand behind, in display order.
 *
 * Every entry here must name a command `registerCommands` registers in the same state,
 * or the tree offers a button that resolves to nothing.
 */
function treeEntries(startup: Startup): TreeEntry[] {
  const settings: TreeEntry = {
    label: "Settings",
    id: "settings",
    visible: "always",
    command: {
      command: "tmc.settings",
      title: "Open TestMyCode settings",
    },
    iconId: "settings-gear",
  }
  const logs: TreeEntry = {
    label: "Show Extension Logs",
    id: "logs",
    visible: "always",
    command: {
      command: "tmc.logs",
      title: "Show Extension Logs",
    },
    iconId: "output",
  }

  if (startup.kind === "degraded") {
    return [
      {
        label: "View initialization error help",
        id: "tmc.viewInitializationErrorHelp",
        visible: "always",
        command: {
          command: "tmc.viewInitializationErrorHelp",
          title: "Open help message for the extension initialization error",
        },
        iconId: "warning",
      },
      {
        label: "Restart extension host",
        id: "workbench.action.restartExtensionHost",
        visible: "always",
        command: {
          command: "workbench.action.restartExtensionHost",
          title: "Restart extension host",
        },
        iconId: "debug-restart",
      },
      settings,
      logs,
    ]
  }

  const { userData } = startup
  return [
    {
      label: "Log in",
      id: "logIn",
      visible: "loggedOut",
      command: {
        command: "tmc.showMoocLogin",
        title: "",
        arguments: [],
      },
      iconId: "sign-in",
    },
    {
      label: "My Courses",
      id: "myCourses",
      visible: "loggedIn",
      command: {
        command: "tmc.myCourses",
        title: "Go to My Courses",
      },
      children: (): TreeEntryChild[] =>
        courseSelectionItems(userData.getCourses()).map(([title, courseId, backend]) => ({
          label: `${title} · ${backend}`,
          id: CourseIdentifier.toString(courseId),
          command: {
            command: "tmc.courseDetails",
            title: "Go to course details",
            arguments: [courseId],
          },
        })),
      iconId: "book",
    },
    settings,
    // Label is backend-neutral: the folder holds both tmc and mooc exercises.
    {
      label: "Open Exercises Folder",
      id: "tmcDataFolder",
      visible: "always",
      command: {
        command: "tmc.openTMCExercisesFolder",
        title: "Open Exercises Folder",
      },
      iconId: "folder-opened",
    },
    logs,
    {
      label: "Log out",
      id: "logOut",
      visible: "loggedIn",
      command: {
        command: "tmc.logout",
        title: "Log out",
      },
      iconId: "sign-out",
    },
  ]
}
