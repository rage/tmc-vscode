import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";
import * as vscode from "vscode";

/**
 * Removes language specific meta files from exercise directory.
 */
export async function cleanExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, tmc, workspaceManager } = actionContext;
    Logger.info("Cleaning exercise");
    if (!(workspaceManager.ok && tmc.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const exercise = resource
        ? workspaceManager.val.getExerciseByPath(resource)
        : workspaceManager.val.activeExercise;
    if (resource && !exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseToClean = exercise?.uri;
    if (!exerciseToClean) {
        Logger.warn("Attempted to clean an exercise without target.");
        return;
    }

    const cleanResult = await tmc.val.clean(exerciseToClean.fsPath);
    if (cleanResult.err) {
        dialog.errorNotification("Failed to clean exercise.", cleanResult.val);
    }
}
