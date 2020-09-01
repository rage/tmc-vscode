import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { showError } from "../window";

export async function resetExercise(
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

    const editor = vscode.window.activeTextEditor;
    const document = editor?.document.uri;

    const resetResult = await actions.resetExercise(actionContext, exerciseId, {
        openAfterwards: true,
    });
    if (resetResult.err) {
        Logger.error("Failed to reset exercise", resetResult.val);
        showError(`Failed to reset exercise: ${resetResult.val.message}`);
        return;
    } else if (!resetResult.val) {
        Logger.log("Didn't reset exercise.");
    } else if (editor && document) {
        Logger.debug(`Reopening original file "${document.fsPath}"`);
        await vscode.commands.executeCommand("vscode.open", document, editor.viewColumn);
    }
}
