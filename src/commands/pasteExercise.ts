import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { BottleneckError } from "../errors";
import { Logger } from "../utils";
import { showError, showNotification } from "../window";

export async function pasteExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { workspaceManager } = actionContext;

    const exercise = resource
        ? workspaceManager.getExerciseByPath(resource)
        : workspaceManager.activeExercise;
    if (!exercise) {
        Logger.error("Currently open editor is not part of a TMC exercise");
        showError("Currently open editor is not part of a TMC exercise");
        return;
    }

    const pasteResult = await actions.pasteExercise(
        actionContext,
        exercise.courseSlug,
        exercise.exerciseSlug,
    );
    if (pasteResult.err) {
        if (pasteResult.val instanceof BottleneckError) {
            Logger.warn(`Paste submission was cancelled: ${pasteResult.val.message}.`);
            return;
        }

        Logger.error("TMC Paste command failed.", pasteResult.val);
        showError(`TMC Paste command failed. ${pasteResult.val.message}`);
        return;
    }
    showNotification(`Paste link: ${pasteResult.val}`, [
        "Open URL",
        (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(pasteResult.val)),
    ]);
}
