import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { Logger } from "../utils/logger";

/**
 * Get the active text editor and figure out the language ID
 * and the executable path from recommended extensions
 * If languageID not supported, returns undefined.
 */
export function getActiveEditorExecutablePath(actionContext: ActionContext): string | undefined {
    const resource = vscode.window.activeTextEditor;
    if (!resource) {
        return undefined;
    }
    Logger.log("Active text document language: " + resource.document.languageId);
    switch (resource.document.languageId) {
        case "python":
            return getPythonPath(actionContext, resource.document);
    }
    return undefined;
}

/**
 * Returns python executable path for ms-python.python extension.
 */
function getPythonPath(
    actionContext: ActionContext,
    document: vscode.TextDocument,
): string | undefined {
    try {
        const extension = vscode.extensions.getExtension("ms-python.python");
        if (!extension) {
            Logger.warn("Extension ms-python.python not found.");
            return undefined;
        }
        const usingNewInterpreterStorage =
            extension.packageJSON?.featureFlags?.usingNewInterpreterStorage;
        if (usingNewInterpreterStorage) {
            if (!extension.isActive) {
                Logger.log("Python extension not active.");
                return undefined;
            }
            // Support old and new python extension versions. vscode-python issue #11294
            const execCommand: string[] = extension.exports.settings.getExecutionDetails
                ? extension.exports.settings.getExecutionDetails(document.uri).execCommand
                : extension.exports.settings.getExecutionCommand(document.uri);
            return execCommand.join(" ");
        } else {
            return actionContext.workspaceManager
                .getWorkspaceSettings()
                .get<string | undefined>("python.pythonPath");
        }
    } catch (error) {
        const message = "Error while fetching python executable string";
        Logger.error(message, error);
        return undefined;
    }
}
