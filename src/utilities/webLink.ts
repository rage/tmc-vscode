import * as vscode from "vscode"

import { Logger } from "./logger"

/**
 * Opens an http(s) `url` in the user's browser; any other link is refused and logged.
 *
 * For every URL a backend or the webview supplied: VS Code's opener would otherwise open a
 * `file:` or `command:` link as readily as a web page.
 *
 * @returns Whether the browser was opened.
 */
export async function openWebLink(url: string): Promise<boolean> {
  const link = parseWebLink(url)
  return link !== undefined && (await vscode.env.openExternal(link))
}

/**
 * `url` as a URI, or `undefined` for anything but http(s).
 *
 * Non-strict `Uri.parse` never throws and invents a `file` scheme for a string without one,
 * so the link is parsed strictly and its scheme checked.
 */
function parseWebLink(url: string): vscode.Uri | undefined {
  let link
  try {
    link = vscode.Uri.parse(url, true)
  } catch (error) {
    Logger.error("Refusing an unparseable link", error)
    return undefined
  }
  if (link.scheme !== "http" && link.scheme !== "https") {
    Logger.error(`Refusing a "${link.scheme}" link`, url)
    return undefined
  }
  return link
}
