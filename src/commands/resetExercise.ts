import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";

/**
 * Resets an exercise to its initial state. Optionally submits the exercise beforehand.
 *
 * @param id ID of the exercise to reset.
 * @param options Optional parameters that can be used to control the action behavior.
 */
export async function resetExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, tmc, userData, workspaceManager } = actionContext;
    Logger.info("Resetting exercise");

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseDetails = userData.getTmcExerciseByName(
        exercise.courseSlug,
        exercise.exerciseSlug,
    );
    if (!exerciseDetails) {
        dialog.errorNotification(`Missing exercise data for ${exercise.exerciseSlug}.`);
        return;
    }

    const submitFirst = await dialog.confirmation(
        "Do you want to save the current state of the exercise by submitting it to TMC Server?",
    );
    if (submitFirst === undefined) {
        Logger.debug("Answer for submitting first not provided, returning early.");
        return;
    }

    const editor = vscode.window.activeTextEditor;
    const document = editor?.document.uri;

    const resetResult = await tmc.resetExercise(
        exerciseDetails.id,
        exercise.uri.fsPath,
        submitFirst,
    );
    if (resetResult.err) {
        dialog.errorNotification("Failed to reset exercise.", resetResult.val);
        return;
    }

    if (editor && document) {
        Logger.debug(`Reopening original file "${document.fsPath}"`);
        await vscode.commands.executeCommand("workbench.action.files.revert", document);
    }
}
