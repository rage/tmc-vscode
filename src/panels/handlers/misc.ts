import * as vscode from "vscode"

import { EXTENSION_ID } from "../../config/constants"
import type { RunnableCommand } from "../../shared/shared"
import { assertUnreachable } from "../../shared/shared"
import { Logger } from "../../utilities"
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
    handle(message): void {
      const link = parseWebLink(message.url)
      if (link) {
        vscode.env.openExternal(link)
      }
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

/**
 * Resolves a link the webview supplied, or `undefined` for anything but http(s).
 *
 * Non-strict `Uri.parse` never throws and invents a `file` scheme for a string without
 * one, so the link is parsed strictly and its scheme checked before the OS handler sees it.
 */
function parseWebLink(url: string): vscode.Uri | undefined {
  let link
  try {
    link = vscode.Uri.parse(url, true)
  } catch (error) {
    Logger.error("Refusing an unparseable link from the webview", error)
    return undefined
  }
  if (link.scheme !== "http" && link.scheme !== "https") {
    Logger.error(`Refusing a "${link.scheme}" link from the webview`, url)
    return undefined
  }
  return link
}

/** The arguments the host supplies for a command the webview may run. */
function runCommandArguments(command: RunnableCommand): unknown[] {
  switch (command) {
    case "workbench.action.openSettings":
      return ["testMyCode.logLevel"]
    case "workbench.action.openIssueReporter":
      return [{ extensionId: EXTENSION_ID }]
    case "tmc.logs":
    case "tmc.myCourses":
    case "tmc.showMoocLogin":
    case "tmc.viewInitializationErrorHelp":
    case "workbench.action.restartExtensionHost":
    case "workbench.extensions.action.checkForUpdates":
      return []
    default:
      return assertUnreachable(command)
  }
}
