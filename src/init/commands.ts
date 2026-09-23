import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext, ReadyActionContext } from "../actions/types"
import { isReady } from "../actions/types"
import type Dialog from "../api/dialog"
import * as commands from "../commands"
import { nextPanelId, registerWebviewHandlers, TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier } from "../shared/shared"
import type UI from "../ui/ui"
import { Logger } from "../utilities"

/**
 * Builds the `register` both registration passes use.
 *
 * VS Code drops whatever a command handler rejects with, so without this a failing
 * command leaves the user with no result and no message.
 */
function commandRegistrar(
  context: vscode.ExtensionContext,
  dialog: Dialog,
): <Args extends unknown[]>(id: string, run: (...args: Args) => unknown) => void {
  return function register<Args extends unknown[]>(
    id: string,
    run: (...args: Args) => unknown,
  ): void {
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
}

/**
 * Registers the commands that need nothing an activation builds.
 *
 * Call before the services are constructed: "Show Logs" and "Settings" are the only
 * palette entries not gated on `test-my-code:Initialized`, so they are all a user can
 * reach while activation is still running. Every id here is left out of
 * {@link registerCommands}; registering one twice throws.
 */
export function registerServiceFreeCommands(
  context: vscode.ExtensionContext,
  dialog: Dialog,
  ui: UI,
): void {
  const register = commandRegistrar(context, dialog)

  // `tmcView.activateEntry` is how every tree entry runs, recovery ones too.
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
}

/**
 * Registers the commands that need the startup state, i.e. everything except
 * {@link registerServiceFreeCommands}'s five.
 *
 * A degraded activation still reaches `tmc.viewInitializationErrorHelp`, the one
 * exception that needs an `ActionContext` but no service; every id after it requires
 * `startup.kind === "ready"`. `package.json` hides the ready-only ones from the palette
 * through `test-my-code:Initialized`.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
): void {
  const { dialog } = actionContext
  Logger.info("Registering TMC VSCode commands")

  registerWebviewHandlers({
    cancelTests: actions.cancelTestRun,
    closeExercises: actions.closeExercises,
    downloadAndOpenExercises: actions.downloadAndOpenExercises,
    downloadExercisesForUi: actions.downloadExercisesForUi,
    openWorkspace: commands.openWorkspace,
    pasteExercise: actions.pasteExercise,
    refreshLocalExercises: actions.refreshLocalExercises,
    removeCourse: actions.removeCourse,
    submitExercise: commands.submitExercise,
    updateCourse: actions.updateCourse,
  })

  const register = commandRegistrar(context, dialog)

  register("tmc.viewInitializationErrorHelp", () => {
    TmcPanel.renderMain(context.extensionUri, context, actionContext, {
      id: nextPanelId(),
      type: "InitializationErrorHelp",
    })
  })

  if (!isReady(actionContext)) {
    return
  }
  // A handler outlives this call, and narrowing does not survive into a closure.
  const readyContext: ReadyActionContext = actionContext

  register("tmcTreeView.refreshCourses", async () => commands.refreshCourses(readyContext))

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
      TmcPanel.renderMain(context.extensionUri, context, readyContext, {
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

  register("tmc.myCourses", () => {
    TmcPanel.renderMain(context.extensionUri, context, readyContext, {
      id: nextPanelId(),
      type: "MyCourses",
      courseDeadlines: {},
    })
  })

  register("tmc.openTMCExercisesFolder", async () => commands.openExercisesFolder(readyContext))

  register("tmc.pasteExercise", async (resource: vscode.Uri | undefined) =>
    commands.pasteExercise(readyContext, resource),
  )

  register("tmc.resetExercise", async (resource: vscode.Uri | undefined) =>
    commands.resetExercise(readyContext, resource),
  )

  register("tmc.showWelcome", () => {
    TmcPanel.renderMain(context.extensionUri, context, readyContext, {
      id: nextPanelId(),
      type: "Welcome",
    })
  })

  // The extension's only login: the courses.mooc.fi device flow.
  register("tmc.showMoocLogin", () => {
    TmcPanel.renderSide(context.extensionUri, context, readyContext, {
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
