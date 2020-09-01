import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { showError } from "../window";

export async function downloadOldSubmission(
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

    const oldDownloadResult = await actions.downloadOldSubmission(actionContext, exerciseId);
    if (oldDownloadResult.err) {
        Logger.error("Failed to download old submission", oldDownloadResult.val);
        showError(`Failed to download old submission: ${oldDownloadResult.val.message}`);
    } else if (!oldDownloadResult.val) {
        Logger.log("Didn't download old exercise.");
    } else if (editor && document) {
        vscode.commands.executeCommand<undefined>("vscode.open", document, editor.viewColumn);
    }
}
