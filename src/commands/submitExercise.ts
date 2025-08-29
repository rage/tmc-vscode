import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { BottleneckError } from "../errors";
import { Logger } from "../utilities";
import * as vscode from "vscode";

export async function submitExercise(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, workspaceManager } = actionContext;
    Logger.info("Submitting exercise");
    if (workspaceManager.err) {
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

    const result = await actions.submitExercise(context, actionContext, exercise);
    if (result.err) {
        if (result.val instanceof BottleneckError) {
            Logger.warn("Submission was cancelled:", result.val);
            return;
        }

        dialog.errorNotification("Exercise submission failed.", result.val);
        return;
    }
}
