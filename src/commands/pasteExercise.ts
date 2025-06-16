import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { BottleneckError } from "../errors";
import { Logger } from "../utilities";

export async function pasteExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { dialog, workspaceManager } = actionContext;
    Logger.info("Pasting exercise");
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

        dialog.errorNotification("TMC Paste command failed.", pasteResult.val);
        return;
    }

    dialog.notification(`Paste link: ${pasteResult.val}`, [
        "Open URL",
        (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(pasteResult.val)),
    ]);
}
