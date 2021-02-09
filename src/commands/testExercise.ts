import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";

export async function testExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, workspaceManager } = actionContext;

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const result = await actions.testExercise(actionContext, exercise);
    if (result.err) {
        dialog.errorNotification("Exercise test run failed.", result.val);
        return;
    }
}
