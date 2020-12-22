import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { showError } from "../window";

/**
 * Removes language specific meta files from exercise directory.
 */
export async function cleanExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { tmc, workspaceManager } = actionContext;

    if (resource && !workspaceManager.uriIsExercise(resource)) {
        Logger.error("Currently open editor is not part of a TMC exercise");
        showError("Currently open editor is not part of a TMC exercise");
        return;
    }

    const exerciseToClean = resource ?? workspaceManager.activeExercise?.uri;
    if (!exerciseToClean) {
        Logger.warn("Attempted to clean an exercise without target.");
        return;
    }

    const cleanResult = await tmc.clean(exerciseToClean.fsPath);
    if (cleanResult.err) {
        const message = "Failed to clean exercise.";
        Logger.error(message, cleanResult.val);
        showError(message);
    }
}
