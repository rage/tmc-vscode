import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { showError, showNotification } from "../window";

export async function pasteExercise(
    actionContext: ActionContext,
    resource: vscode.Uri | undefined,
): Promise<void> {
    const { workspaceManager } = actionContext;
    const exerciseId =
        workspaceManager.checkIfPathIsExercise(resource?.fsPath) ??
        workspaceManager.getCurrentExerciseId();
    if (!exerciseId) {
        Logger.error("Currently open editor is not part of a TMC exercise");
        showError("Currently open editor is not part of a TMC exercise");
        return;
    }

    const link = await actions.pasteExercise(actionContext, exerciseId);
    if (link.err) {
        Logger.error("TMC Paste command failed.", link.val);
        showError(`TMC Paste command failed. ${link.val.message}`);
        return;
    }
    showNotification(`Paste link: ${link.val}`, [
        "Open URL",
        (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(link.val)),
    ]);
}
