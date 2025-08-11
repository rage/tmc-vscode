import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";
import { LocalCourseData, LocalCourseExercise } from "../shared/shared";

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

    const localExercise = userData.val.getExerciseByName(
        exercise.courseSlug,
        exercise.exerciseSlug,
    );
    const exerciseId = localExercise ? LocalCourseExercise.getId(localExercise) : undefined;
    if (
        exerciseId &&
        (userData.val.getPassed(exerciseId) ||
            (await dialog.confirmation(
                `Are you sure you want to close uncompleted exercise ${exercise.exerciseSlug}?`,
            )))
    ) {
        const course = userData.val.getCourseBySlug(exercise.courseSlug);
        const courseId = LocalCourseData.getCourseId(course);
        const result = await actions.closeExercises(actionContext, [exerciseId], courseId);
        if (result.err) {
            dialog.errorNotification("Error when closing exercise.", result.val);
            return;
        }

        vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
}
