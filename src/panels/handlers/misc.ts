import { Ok } from "ts-results"
import * as vscode from "vscode"

import { EXTENSION_ID } from "../../config/constants"
import type { WebviewToExtension } from "../../shared/shared"
import { assertUnreachable } from "../../shared/shared"
import { cliFolder, Logger } from "../../utilities"
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
  requestInitializationErrors: {
    requiresReady: false,
    handle(_message, { actionContext, extensionContext }) {
      const failures =
        actionContext.startup.kind === "degraded" ? actionContext.startup.failures : {}
      return Ok({
        cliFolder: cliFolder(extensionContext),
        initializationErrors: {
          tmc: formatError(failures.langs),
          userData: formatError(failures.userData),
          workspaceManager: formatError(failures.workspaceManager),
          resources: formatError(failures.resources),
          exerciseDecorationProvider: formatError(failures.exerciseDecorationProvider),
        },
      })
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

type RunnableCommand = Extract<WebviewToExtension, { type: "runCommand" }>["command"]

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
    case "workbench.action.restartExtensionHost":
      return []
    default:
      return assertUnreachable(command)
  }
}

function formatError(error: Error | undefined): { error: string; stack: string } | null {
  if (!error) {
    return null
  }
  const stack = error.stack ?? "no stack trace"
  return error.cause
    ? { error: `${error.message}: ${error.cause}`, stack }
    : { error: error.message, stack }
}
