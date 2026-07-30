import * as vscode from "vscode"

import * as actions from "../actions"
import { checkForCourseUpdates } from "../actions"
import type { ActionContext } from "../actions/types"
import * as commands from "../commands"
import { randomPanelId, TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities/"

export function registerCommands(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
): void {
  const { dialog, ui, userData, resources } = actionContext
  Logger.info("Registering TMC VSCode commands")

  // Commands not shown to user in Command Palette / TMC Action menu
  context.subscriptions.push(
    vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
    vscode.commands.registerCommand("tmcTreeView.refreshCourses", async () => {
      await checkForCourseUpdates(actionContext)
      await commands.updateExercises(actionContext, "loud")
    }),

    // Commands shown to user in Command Palette / TMC Action menu
    vscode.commands.registerCommand("tmc.addNewCourse", async () =>
      commands.addNewCourse(actionContext),
    ),

    vscode.commands.registerCommand("tmc.changeTmcDataPath", async () =>
      commands.changeTmcDataPath(actionContext),
    ),

    vscode.commands.registerCommand("tmc.cleanExercise", async (resource: vscode.Uri | undefined) =>
      commands.cleanExercise(actionContext, resource),
    ),

    vscode.commands.registerCommand("tmc.closeExercise", async (resource: vscode.Uri | undefined) =>
      commands.closeExercise(actionContext, resource),
    ),

    vscode.commands.registerCommand("tmc.courseDetails", async (courseId?: CourseIdentifier) => {
      if (userData.err) {
        Logger.error("The extension was not initialized properly")
        return
      }

      const courses = userData.val.getCourses()
      if (courses.length === 0) {
        return
      }
      courseId =
        courseId ??
        (await dialog.selectItem(
          { title: "Course Details", placeHolder: "Which course page do you want to open?" },
          ...courses.map<[string, CourseIdentifier]>((c) => [
            LocalCourseData.getCourseName(c),
            LocalCourseData.getCourseId(c),
          ]),
        ))
      if (courseId) {
        TmcPanel.renderMain(context.extensionUri, context, actionContext, {
          id: randomPanelId(),
          type: "CourseDetails",
          courseId,
          exerciseStatuses: { tmc: {}, mooc: {} },
        })
      }
    }),

    vscode.commands.registerCommand("tmc.downloadNewExercises", async () =>
      commands.downloadNewExercises(actionContext),
    ),

    vscode.commands.registerCommand(
      "tmc.downloadOldSubmission",
      async (resource: vscode.Uri | undefined) =>
        commands.downloadOldSubmission(actionContext, resource),
    ),

    vscode.commands.registerCommand("tmc.logout", async () => {
      if (await dialog.confirmation("Are you sure you want to log out?")) {
        // The action layer reports failures itself; only announce success here.
        const deauth = await actions.logout(actionContext)
        if (deauth.ok) {
          dialog.notification("Logged out from TestMyCode.")
        }
      }
    }),

    vscode.commands.registerCommand("tmc.myCourses", async () => {
      TmcPanel.renderMain(context.extensionUri, context, actionContext, {
        id: randomPanelId(),
        type: "MyCourses",
        courseDeadlines: {},
      })
    }),

    vscode.commands.registerCommand("tmc.settings", async () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "TestMyCode")
    }),

    vscode.commands.registerCommand("tmc.openTMCExercisesFolder", async () => {
      if (!(resources.ok && resources.val.projectsDirectory)) {
        Logger.error("The extension was not initialized properly")
        return
      }

      vscode.commands.executeCommand(
        "revealFileInOS",
        vscode.Uri.file(resources.val.projectsDirectory),
      )
    }),

    vscode.commands.registerCommand("tmc.pasteExercise", async (resource: vscode.Uri | undefined) =>
      commands.pasteExercise(actionContext, resource),
    ),

    vscode.commands.registerCommand("tmc.resetExercise", async (resource: vscode.Uri | undefined) =>
      commands.resetExercise(actionContext, resource),
    ),

    vscode.commands.registerCommand("tmc.selectAction", async () => {
      vscode.commands.executeCommand(
        "workbench.action.quickOpen",
        ">TestMyCode: ",
        "test-my-code:WorkspaceActive",
      )
    }),

    vscode.commands.registerCommand("tmc.showWelcome", async () => {
      TmcPanel.renderMain(context.extensionUri, context, actionContext, {
        id: randomPanelId(),
        type: "Welcome",
      })
    }),

    // The only login: courses.mooc.fi device flow. Reached from the Command
    // Palette, the tree view's "Log in" entry and the session-expired prompt.
    // No `requestingPanel`: nothing to return to on success.
    vscode.commands.registerCommand("tmc.showMoocLogin", async () => {
      TmcPanel.renderSide(context.extensionUri, context, actionContext, {
        id: randomPanelId(),
        type: "MoocLogin",
      })
    }),

    vscode.commands.registerCommand(
      "tmc.submitExercise",
      async (resource: vscode.Uri | undefined) => {
        commands.submitExercise(context, actionContext, resource)
      },
    ),

    vscode.commands.registerCommand("tmc.switchWorkspace", async () =>
      commands.switchWorkspace(actionContext),
    ),

    vscode.commands.registerCommand(
      "tmc.testExercise",
      async (resource: vscode.Uri | undefined) => {
        commands.testExercise(context, actionContext, resource)
      },
    ),

    vscode.commands.registerCommand("tmc.updateExercises", async (silent: string) =>
      commands.updateExercises(actionContext, silent),
    ),

    vscode.commands.registerCommand("tmc.logs", async () => {
      Logger.show()
    }),

    vscode.commands.registerCommand("tmc.debug", async () => {
      vscode.commands.executeCommand("workbench.output.action.clearOutput")
      Logger.show()
      vscode.commands.executeCommand("workbench.action.openActiveLogOutputFile")
    }),

    vscode.commands.registerCommand("tmc.wipe", async () => commands.wipe(actionContext, context)),

    vscode.commands.registerCommand("tmc.viewInitializationErrorHelp", async () => {
      TmcPanel.renderMain(context.extensionUri, context, actionContext, {
        id: randomPanelId(),
        type: "InitializationErrorHelp",
      })
    }),
  )
}
