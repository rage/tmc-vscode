import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";
import * as vscode from "vscode";

export async function closeExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, userData, workspaceManager } = actionContext;
    Logger.info("Closing exercise");
    if (!(workspaceManager.ok && userData.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const exercise = resource
        ? workspaceManager.val.getExerciseByPath(resource)
        : workspaceManager.val.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const exerciseId = userData.val.getExerciseByName(
        exercise.courseSlug,
        exercise.exerciseSlug,
    )?.id;
    if (
        exerciseId &&
        (userData.val.getPassed(exerciseId) ||
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
