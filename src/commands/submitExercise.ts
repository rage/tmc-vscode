import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { BottleneckError } from "../errors";
import { Logger } from "../utilities";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

export async function submitExercise(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<Result<void, Error>> {
    const { dialog, workspaceManager } = actionContext;
    Logger.info("Submitting exercise");
    if (workspaceManager.err) {
        Logger.error("Extension was not initialized properly");
        return Err(new Error("Extension was not initialized properly"));
    }

    const exercise = resource
        ? workspaceManager.val.getExerciseByPath(resource)
        : workspaceManager.val.activeExercise;
    if (!exercise) {
        const message = "Currently open editor is not part of a TMC exercise.";
        dialog.errorNotification(message);
        return Err(new Error(message));
    }

    const result = await actions.submitExercise(context, actionContext, exercise);
    if (result.err) {
        if (result.val instanceof BottleneckError) {
            Logger.warn("Submission was cancelled:", result.val);
            return result;
        }

        dialog.errorNotification("Exercise submission failed.", result.val);
        return result;
    }

    return Ok.EMPTY;
}
