import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import * as commands from "../commands"
import { nextPanelId, registerWebviewHandlers, TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier } from "../shared/shared"
import { Logger } from "../utilities"

export function registerCommands(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
): void {
  const { dialog, ui, resources } = actionContext
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
    refreshLocalExercises: actions.refreshLocalExercises,
    removeCourse: actions.removeCourse,
    submitExercise: commands.submitExercise,
    updateCourse: actions.updateCourse,
  })

  // VS Code drops whatever a command handler rejects with, so without this a
  // failing command leaves the user with no result and no message.
  function register<Args extends unknown[]>(id: string, run: (...args: Args) => unknown): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: Args) => {
        try {
          return await run(...args)
        } catch (e) {
          void dialog.reportError(
            `Failed to run ${id}.`,
            e instanceof Error ? e : new Error(String(e)),
          )
          return undefined
        }
      }),
    )
  }

  // Commands not shown to user in Command Palette / TMC Action menu
  register("tmcView.activateEntry", ui.createUiActionHandler())

  register("tmcTreeView.refreshCourses", async () => {
    await dialog.progressNotification("Fetching course updates...", async (progress) => {
      await actions.refreshEverything(actionContext, {
        silent: false,
        onProgress: (done, total) => {
          progress.report({ fraction: total === 0 ? 1 : done / total })
        },
      })
    })
  })

  // Commands shown to user in Command Palette / TMC Action menu
  register("tmc.addNewCourse", async () => commands.addNewCourse(actionContext))

  register("tmc.changeTmcDataPath", async () => commands.changeTmcDataPath(actionContext))

  register("tmc.cleanExercise", async (resource: vscode.Uri | undefined) =>
    commands.cleanExercise(actionContext, resource),
  )

  register("tmc.closeExercise", async (resource: vscode.Uri | undefined) =>
    commands.closeExercise(actionContext, resource),
  )

  register("tmc.courseDetails", async (courseId?: CourseIdentifier) => {
    courseId ??= await commands.pickCourse(actionContext, {
      title: "Course Details",
      placeHolder: "Which course page do you want to open?",
    })
    if (courseId) {
      await TmcPanel.renderMain(context.extensionUri, context, actionContext, {
        id: nextPanelId(),
        type: "CourseDetails",
        courseId,
        exerciseStatuses: { tmc: {}, mooc: {} },
      })
    }
  })

  register("tmc.downloadNewExercises", async () => commands.downloadNewExercises(actionContext))

  register("tmc.downloadOldSubmission", async (resource: vscode.Uri | undefined) =>
    commands.downloadOldSubmission(actionContext, resource),
  )

  register("tmc.logout", async () => commands.logout(actionContext))

  register("tmc.myCourses", async () => {
    await TmcPanel.renderMain(context.extensionUri, context, actionContext, {
      id: nextPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
  })

  register("tmc.settings", async () => {
    await vscode.commands.executeCommand("workbench.action.openSettings", "TestMyCode")
  })

  register("tmc.openTMCExercisesFolder", async () => {
    if (!(resources.ok && resources.val.projectsDirectory)) {
      Logger.error("The extension was not initialized properly")
      return
    }

    await vscode.commands.executeCommand(
      "revealFileInOS",
      vscode.Uri.file(resources.val.projectsDirectory),
    )
  })

  register("tmc.pasteExercise", async (resource: vscode.Uri | undefined) =>
    commands.pasteExercise(actionContext, resource),
  )

  register("tmc.resetExercise", async (resource: vscode.Uri | undefined) =>
    commands.resetExercise(actionContext, resource),
  )

  register("tmc.selectAction", async () => {
    await vscode.commands.executeCommand("workbench.action.quickOpen", ">TestMyCode: ")
  })

  register("tmc.showWelcome", async () => {
    await TmcPanel.renderMain(context.extensionUri, context, actionContext, {
      id: nextPanelId(),
      type: "Welcome",
    })
  })

  // The extension's only login: the courses.mooc.fi device flow.
  register("tmc.showMoocLogin", async () => {
    await TmcPanel.renderSide(context.extensionUri, context, actionContext, {
      id: nextPanelId(),
      type: "MoocLogin",
    })
  })

  register("tmc.submitExercise", async (resource: vscode.Uri | undefined) =>
    commands.submitExercise(context, actionContext, resource),
  )

  register("tmc.switchWorkspace", async () => commands.switchWorkspace(actionContext))

  register("tmc.testExercise", async (resource: vscode.Uri | undefined) =>
    commands.testExercise(context, actionContext, resource),
  )

  register("tmc.updateExercises", async (mode?: "silent" | "loud") =>
    commands.updateExercises(actionContext, mode),
  )

  register("tmc.logs", async () => {
    Logger.show()
  })

  register("tmc.debug", async () => {
    await vscode.commands.executeCommand("workbench.output.action.clearOutput")
    Logger.show()
    await vscode.commands.executeCommand("workbench.action.openActiveLogOutputFile")
  })

  register("tmc.wipe", async () => commands.wipe(actionContext, context))

  register("tmc.viewInitializationErrorHelp", async () => {
    await TmcPanel.renderMain(context.extensionUri, context, actionContext, {
      id: nextPanelId(),
      type: "InitializationErrorHelp",
    })
  })
}
