import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";

export async function testExercise(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, workspaceManager } = actionContext;
    Logger.info("Testing exercise");

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const result = await actions.testExercise(context, actionContext, exercise);
    if (result.err) {
        dialog.errorNotification("Exercise test run failed.", result.val);
        return;
    }
}
