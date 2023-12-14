import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";

export async function closeExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, userData, workspaceManager } = actionContext;
    Logger.info("Closing exercise");

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseId = userData.getExerciseByName(exercise.courseSlug, exercise.exerciseSlug)?.id;
    if (
        exerciseId &&
        (userData.getPassed(exerciseId) ||
            (await dialog.confirmation(
                `Are you sure you want to close uncompleted exercise ${exercise.exerciseSlug}?`,
            )))
    ) {
        const result = await actions.closeExercises(
            actionContext,
            [exerciseId],
            exercise.courseSlug,
        );
        if (result.err) {
            dialog.errorNotification("Error when closing exercise.", result.val);
            return;
        }

        vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
}
