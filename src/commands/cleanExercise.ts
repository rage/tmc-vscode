import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";

/**
 * Removes language specific meta files from exercise directory.
 */
export async function cleanExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, langs, workspaceManager } = actionContext;
    Logger.info("Cleaning exercise");
    if (!(workspaceManager.ok && langs.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    if (resource && !workspaceManager.val.uriIsExercise(resource)) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseToClean = resource ?? workspaceManager.val.activeExercise?.uri;
    if (!exerciseToClean) {
        Logger.warn("Attempted to clean an exercise without target.");
        return;
    }

    const cleanResult = await langs.val.clean(exerciseToClean.fsPath);
    if (cleanResult.err) {
        dialog.errorNotification("Failed to clean exercise.", cleanResult.val);
    }
}
