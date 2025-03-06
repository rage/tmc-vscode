import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { BottleneckError } from "../errors";
import { Logger } from "../utilities";

export async function submitExercise(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, workspaceManager } = actionContext;
    Logger.info("Submitting exercise");

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        dialog.errorNotification("Currently open editor is not part of a TMC exercise.");
        return;
    }

    const result = await actions.submitTmcExercise(context, actionContext, exercise);
    if (result.err) {
        if (result.val instanceof BottleneckError) {
            Logger.warn("Submission was cancelled:", result.val);
            return;
        }

        dialog.errorNotification("Exercise submission failed.", result.val);
        return;
    }
}
