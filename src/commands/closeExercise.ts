import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { askForConfirmation, showError } from "../window";

export async function closeExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { userData, workspaceManager } = actionContext;
    const exerciseId =
        workspaceManager.checkIfPathIsExercise(resource?.fsPath) ??
        workspaceManager.getCurrentExerciseId();
    if (!exerciseId) {
        Logger.error("Currently open editor is not part of a TMC exercise");
        showError("Currently open editor is not part of a TMC exercise");
        return;
    }

    const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
    if (exerciseData.err) {
        const message = "The data for this exercise seems to be missing.";
        Logger.error(message, exerciseData.val);
        showError(message);
        return;
    }
    if (
        userData.getPassed(exerciseId) ||
        (await askForConfirmation(
            `Are you sure you want to close uncompleted exercise ${exerciseData.val.name}?`,
        ))
    ) {
        const result = await actions.closeExercises(
            actionContext,
            [exerciseId],
            exerciseData.val.course,
        );
        if (result.err) {
            const message = "Error when closing exercise.";
            Logger.error(message, result.val);
            showError(message);
            return;
        }
        vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
}
