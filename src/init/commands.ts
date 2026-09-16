import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import * as commands from "../commands"
import { randomPanelId, registerWebviewHandlers, TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier } from "../shared/shared"
import { backendName, LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities/"

export function registerCommands(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
): void {
  const { dialog, ui, userData, resources } = actionContext
  Logger.info("Registering TMC VSCode commands")

  registerWebviewHandlers({
    cancelTests: (testRunId) => {
      const interrupts = actions.testInterrupts.get(testRunId)
      if (interrupts) {
        for (const interrupt of interrupts) {
          interrupt()
        }
        actions.testInterrupts.delete(testRunId)
      }
    },
    closeExercises: actions.closeExercises,
    downloadAndOpenExercises: actions.downloadAndOpenExercises,
    downloadExercisesForUi: actions.downloadExercisesForUi,
    openWorkspace: actions.openWorkspace,
    pasteMoocExercise: actions.pasteMoocExercise,
    pasteTmcExercise: actions.pasteTmcExercise,
    removeCourse: actions.removeCourse,
    submitExercise: commands.submitExercise,
    updateCourse: actions.updateCourse,
  })

  // Commands not shown to user in Command Palette / TMC Action menu
  context.subscriptions.push(
    vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
    vscode.commands.registerCommand("tmcTreeView.refreshCourses", async () => {
      await dialog.progressNotification("Fetching course updates...", async (progress) => {
        await actions.refreshEverything(actionContext, {
          silent: false,
          onProgress: (done, total) => {
            progress.report({ percent: total === 0 ? 1 : done / total })
          },
        })
      })
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
          ...courses.map<[string, CourseIdentifier, string]>((c) => [
            LocalCourseData.getCourseName(c),
            LocalCourseData.getCourseId(c),
            backendName(c.kind),
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

    // The extension's only login: the courses.mooc.fi device flow.
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
