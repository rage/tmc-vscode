import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { RunnableCommand } from "../../../shared/lib"
import { assertUnreachable } from "../../../shared/lib"
import { EXTENSION_ID } from "../../config/constants"
import { Logger, openWebLink } from "../../utilities"
import type { HandlerMap } from "../router"
import { errorDetailsPanel } from "../routes"

/** Messages any screen may send. */
export const miscHandlers = {
  closeSidePanel: {
    requiresReady: false,
    handle(_message, { host }): void {
      host.closeSidePanel()
    },
  },
  openLinkInBrowser: {
    requiresReady: false,
    async handle(message): Promise<void> {
      await openWebLink(message.url)
    },
  },
  webviewError: {
    requiresReady: false,
    handle(message, { host }): void {
      Logger.error(`${host.name} error: ${message.message}`, message.stack ?? "")
    },
  },
  showErrorDetails: {
    requiresReady: false,
    handle(message, { host }): void {
      host.showBeside(errorDetailsPanel(message.detailsId))
    },
  },
  revealCliFolder: {
    requiresReady: false,
    async handle(_message, { host }): Promise<void> {
      // The folder comes from the screen the host built, never from the webview.
      const folder = host.route?.type === "ErrorHelp" ? host.route.cliFolder : undefined
      if (folder !== undefined) {
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(folder))
      }
    },
  },
  requestLogTail: {
    requiresReady: false,
    handle(): Result<string, never> {
      return Ok(Logger.tail())
    },
  },
  runCommand: {
    requiresReady: false,
    async handle(message): Promise<void> {
      await vscode.commands.executeCommand(message.command, ...runCommandArguments(message.command))
    },
  },
} satisfies Partial<HandlerMap>

/** The arguments the host supplies for a command the webview may run. */
function runCommandArguments(command: RunnableCommand): unknown[] {
  switch (command) {
    case "workbench.action.openSettings":
      return ["testMyCode.logLevel"]
    case "workbench.action.openIssueReporter":
      return [{ extensionId: EXTENSION_ID }]
    case "tmc.changeTmcDataPath":
    case "tmc.enrollOnCourse":
    case "tmc.logs":
    case "tmc.myCourses":
    case "tmc.openTroubleshooting":
    case "tmc.showAiUseProblem":
    case "tmc.showMoocLogin":
    case "tmc.trustCourseWorkspace":
    case "tmc.viewInitializationErrorHelp":
    case "tmcTreeView.refreshCourses":
    case "workbench.action.restartExtensionHost":
    case "workbench.extensions.action.checkForUpdates":
      return []
    default:
      return assertUnreachable(command)
  }
}
