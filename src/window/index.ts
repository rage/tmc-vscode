import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { Logger } from "../utilities/logger"

const PYTHON_EXTENSION_ID = "ms-python.python"

/** The slice of the Python extension's API that names the interpreter for a file. */
interface PythonExtensionApi {
  environments?: {
    getActiveEnvironmentPath?: (resource?: vscode.Uri) => { path?: string } | undefined
  }
}

/**
 * Resolves the interpreter the CLI should run the active editor's exercise with.
 *
 * @returns `undefined` for a language that needs no interpreter named, and whenever none
 * can be resolved — the CLI then chooses one itself.
 */
export function getActiveEditorExecutablePath(_actionContext: ActionContext): string | undefined {
  const resource = vscode.window.activeTextEditor
  if (!resource) {
    return undefined
  }
  Logger.info("Active text document language:", resource.document.languageId)
  switch (resource.document.languageId) {
    case "python":
      return getPythonPath(resource.document)
  }
  return undefined
}

function getPythonPath(document: vscode.TextDocument): string | undefined {
  try {
    const extension = vscode.extensions.getExtension(PYTHON_EXTENSION_ID)
    if (!extension) {
      Logger.warn(`${PYTHON_EXTENSION_ID} is not installed.`)
      return interpreterFromSettings(document)
    }
    if (!extension.isActive) {
      Logger.warn(`${PYTHON_EXTENSION_ID} has not activated yet.`)
      return interpreterFromSettings(document)
    }
    const api = extension.exports as PythonExtensionApi | undefined
    const activePath = api?.environments?.getActiveEnvironmentPath?.(document.uri)?.path
    if (!activePath) {
      Logger.warn(`${PYTHON_EXTENSION_ID} names no environment for ${document.uri.fsPath}.`)
      return interpreterFromSettings(document)
    }
    return activePath
  } catch (error) {
    Logger.error("Error while resolving the python interpreter", error)
    return undefined
  }
}

/** Reads the interpreter at the document's own folder scope, not the window's. */
function interpreterFromSettings(document: vscode.TextDocument): string | undefined {
  const configured = vscode.workspace
    .getConfiguration("python", document.uri)
    .get<string>("defaultInterpreterPath")
  if (!configured) {
    Logger.warn("No python.defaultInterpreterPath is set; letting the CLI choose.")
    return undefined
  }
  return configured
}
