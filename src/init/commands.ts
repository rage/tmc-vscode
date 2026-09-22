import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext, ReadyActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import * as commands from "../commands"
import { nextPanelId, registerWebviewHandlers, TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier } from "../shared/shared"
import { Logger } from "../utilities"

/**
 * Registers the commands the given startup state can actually run.
 *
 * A degraded activation gets only the entries that need no service behind them, so the
 * rest cannot be reached at all rather than reached and silently refused. `package.json`
 * hides the same commands from the palette through `test-my-code:Initialized`.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
): void {
  const { dialog, ui } = actionContext
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

  // Registered whatever activation managed to build: none of these reaches a service.
  // `tmcView.activateEntry` included -- it is how every tree entry runs, recovery ones too.
  register("tmcView.activateEntry", ui.createUiActionHandler())

  register("tmc.settings", async () => {
    await vscode.commands.executeCommand("workbench.action.openSettings", "TestMyCode")
  })

  register("tmc.selectAction", async () => {
    await vscode.commands.executeCommand("workbench.action.quickOpen", ">TestMyCode: ")
  })

  register("tmc.logs", async () => {
    Logger.show()
  })

  register("tmc.debug", async () => {
    await vscode.commands.executeCommand("workbench.output.action.clearOutput")
    Logger.show()
    await vscode.commands.executeCommand("workbench.action.openActiveLogOutputFile")
  })

  register("tmc.viewInitializationErrorHelp", async () => {
    await TmcPanel.renderMain(context.extensionUri, context, actionContext, {
      id: nextPanelId(),
      type: "InitializationErrorHelp",
    })
  })

  if (!isReady(actionContext)) {
    return
  }
  // A handler outlives this call, and narrowing does not survive into a closure.
  const readyContext: ReadyActionContext = actionContext

  register("tmcTreeView.refreshCourses", async () => {
    await dialog.progressNotification("Fetching course updates...", async (progress) => {
      await actions.refreshEverything(readyContext, {
        silent: false,
        onProgress: (done, total) => {
          progress.report({ fraction: total === 0 ? 1 : done / total })
        },
      })
    })
  })

  register("tmc.addNewCourse", async () => commands.addNewCourse(readyContext))

  register("tmc.changeTmcDataPath", async () => commands.changeTmcDataPath(readyContext))

  register("tmc.cleanExercise", async (resource: vscode.Uri | undefined) =>
    commands.cleanExercise(readyContext, resource),
  )

  register("tmc.closeExercise", async (resource: vscode.Uri | undefined) =>
    commands.closeExercise(readyContext, resource),
  )

  register("tmc.courseDetails", async (courseId?: CourseIdentifier) => {
    courseId ??= await commands.pickCourse(readyContext, {
      title: "Course Details",
      placeHolder: "Which course page do you want to open?",
    })
    if (courseId) {
      await TmcPanel.renderMain(context.extensionUri, context, readyContext, {
        id: nextPanelId(),
        type: "CourseDetails",
        courseId,
        exerciseStatuses: { tmc: {}, mooc: {} },
      })
    }
  })

  register("tmc.downloadNewExercises", async () => commands.downloadNewExercises(readyContext))

  register("tmc.downloadOldSubmission", async (resource: vscode.Uri | undefined) =>
    commands.downloadOldSubmission(readyContext, resource),
  )

  register("tmc.logout", async () => commands.logout(readyContext))

  register("tmc.myCourses", async () => {
    await TmcPanel.renderMain(context.extensionUri, context, readyContext, {
      id: nextPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
  })

  register("tmc.openTMCExercisesFolder", async () => {
    const { projectsDirectory } = readyContext.startup.resources
    if (!projectsDirectory) {
      Logger.error("Cannot open the exercises folder: tmc-langs reported no exercise directory")
      return
    }

    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(projectsDirectory))
  })

  register("tmc.pasteExercise", async (resource: vscode.Uri | undefined) =>
    commands.pasteExercise(readyContext, resource),
  )

  register("tmc.resetExercise", async (resource: vscode.Uri | undefined) =>
    commands.resetExercise(readyContext, resource),
  )

  register("tmc.showWelcome", async () => {
    await TmcPanel.renderMain(context.extensionUri, context, readyContext, {
      id: nextPanelId(),
      type: "Welcome",
    })
  })

  // The extension's only login: the courses.mooc.fi device flow.
  register("tmc.showMoocLogin", async () => {
    await TmcPanel.renderSide(context.extensionUri, context, readyContext, {
      id: nextPanelId(),
      type: "MoocLogin",
    })
  })

  register("tmc.submitExercise", async (resource: vscode.Uri | undefined) =>
    commands.submitExercise(context, readyContext, resource),
  )

  register("tmc.switchWorkspace", async () => commands.switchWorkspace(readyContext))

  register("tmc.testExercise", async (resource: vscode.Uri | undefined) =>
    commands.testExercise(context, readyContext, resource),
  )

  register("tmc.updateExercises", async (mode?: "silent" | "loud") =>
    commands.updateExercises(readyContext, mode),
  )

  register("tmc.wipe", async () => commands.wipe(readyContext, context))
}
