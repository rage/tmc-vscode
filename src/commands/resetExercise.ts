import * as vscode from "vscode";

import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { askForItem, showError } from "../window";

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
    const { tmc, userData, workspaceManager } = actionContext;

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        Logger.error("Currently open editor is not part of a TMC exercise");
        showError("Currently open editor is not part of a TMC exercise");
        return;
    }

    const exerciseDetails = userData.getExerciseByName(exercise.course, exercise.name);
    if (!exerciseDetails) {
        Logger.error(`Missing exercise data for ${exercise.name}`);
        showError("Currently open editor is not part of a TMC exercise");
        return;
    }

    const submitFirst = await askForItem(
        "Do you want to save the current state of the exercise by submitting it to TMC Server?",
        false,
        ["Yes", true],
        ["No", false],
        ["Cancel", undefined],
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
        Logger.error("Failed to reset exercise", resetResult.val);
        showError(`Failed to reset exercise: ${resetResult.val.message}`);
        return;
    }

    if (editor && document) {
        Logger.debug(`Reopening original file "${document.fsPath}"`);
        await vscode.commands.executeCommand("vscode.open", document, editor.viewColumn);
    }
}
