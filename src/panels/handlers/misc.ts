import * as vscode from "vscode"

import type { RunnableCommand } from "../../../shared/lib"
import { assertUnreachable } from "../../../shared/lib"
import { EXTENSION_ID } from "../../config/constants"
import { Logger, openWebLink } from "../../utilities"
import type { HandlerMap } from "../router"

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
    case "tmc.logs":
    case "tmc.myCourses":
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
