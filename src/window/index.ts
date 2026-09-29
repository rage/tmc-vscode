import * as vscode from "vscode"

import { Logger } from "../utilities/logger"

const PYTHON_EXTENSION_ID = "ms-python.python"

/** The slice of the Python extension's API that names the interpreter for a file. */
interface PythonExtensionApi {
  environments?: {
    getActiveEnvironmentPath?: (resource?: vscode.Uri) => { path?: string } | undefined
  }
}

/**
 * Resolves the Python interpreter for the exercise at `exerciseUri`, as the Python extension or
 * the settings name it for that folder. The CLI reads it only for Python exercises.
 *
 * @returns `undefined` when none can be resolved; the CLI then chooses one itself.
 */
export function resolvePythonInterpreter(exerciseUri: vscode.Uri): string | undefined {
  try {
    const extension = vscode.extensions.getExtension(PYTHON_EXTENSION_ID)
    if (!extension) {
      Logger.debug(`${PYTHON_EXTENSION_ID} is not installed.`)
      return interpreterFromSettings(exerciseUri)
    }
    if (!extension.isActive) {
      Logger.debug(`${PYTHON_EXTENSION_ID} has not activated yet.`)
      return interpreterFromSettings(exerciseUri)
    }
    const api = extension.exports as PythonExtensionApi | undefined
    const activePath = api?.environments?.getActiveEnvironmentPath?.(exerciseUri)?.path
    if (!activePath) {
      Logger.debug(`${PYTHON_EXTENSION_ID} names no environment for ${exerciseUri.fsPath}.`)
      return interpreterFromSettings(exerciseUri)
    }
    return activePath
  } catch (error) {
    Logger.error("Error while resolving the python interpreter", error)
    return undefined
  }
}

/** Reads the interpreter at the exercise folder's own scope, not the window's. */
function interpreterFromSettings(exerciseUri: vscode.Uri): string | undefined {
  const configured = vscode.workspace
    .getConfiguration("python", exerciseUri)
    .get<string>("defaultInterpreterPath")
  if (!configured) {
    Logger.debug("No python.defaultInterpreterPath is set; letting the CLI choose.")
    return undefined
  }
  return configured
}
