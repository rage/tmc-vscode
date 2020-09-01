import * as vscode from "vscode";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utils";
import { showError } from "../window";

export async function testExercise(
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
    const result = await actions.testExercise(actionContext, exerciseId);
    if (result.err) {
        Logger.error("Exercise test run failed.", result.val);
        showError("Exercise test run failed.");
        return;
    }
}
