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
    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        Logger.error("Currently open editor is not part of a TMC exercise");
        showError("Currently open editor is not part of a TMC exercise");
        return;
    }

    const exerciseId = userData.getExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id;
    if (
        exerciseId &&
        (userData.getPassed(exerciseId) ||
            (await askForConfirmation(
                `Are you sure you want to close uncompleted exercise ${exercise.exerciseSlug}?`,
            )))
    ) {
        const result = await actions.closeExercises(
            actionContext,
            [exerciseId],
            exercise.courseSlug,
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
