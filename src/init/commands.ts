import * as vscode from "vscode";
import * as path from "path";
import { ActionContext } from "../actions/types";
import {
    askForConfirmation,
    getCurrentExerciseData,
    getCurrentExerciseId,
    showNotification,
} from "../utils/";
import {
    pasteExercise,
    resetExercise,
    selectAction,
    submitExercise,
    testExercise,
} from "../actions";

export function registerCommands(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
): void {
    const { ui, workspaceManager, userData } = actionContext;

    context.subscriptions.push(
        vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("selectAction", async () => {
            const exerciseData = getCurrentExerciseData(workspaceManager);
            if (exerciseData.err) {
                vscode.window.showErrorMessage(exerciseData.val.message);
                return;
            }
            selectAction(actionContext, exerciseData.val);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("uploadArchive", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            exerciseId
                ? submitExercise(actionContext, exerciseId)
                : vscode.window.showErrorMessage(
                      "Currently open editor is not part of a TMC exercise",
                  );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("pasteExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            exerciseId
                ? pasteExercise(actionContext, exerciseId)
                : vscode.window.showErrorMessage(
                      "Currently open editor is not part of a TMC exercise",
                  );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("runTests", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            exerciseId
                ? testExercise(actionContext, exerciseId)
                : vscode.window.showErrorMessage(
                      "Currently open editor is not part of a TMC exercise",
                  );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("resetExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                vscode.window.showErrorMessage(
                    "Currently open editor is not part of a TMC exercise",
                );
                return;
            }
            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (exerciseData.err) {
                vscode.window.showErrorMessage("The data for this exercise seems to be missing");
                return;
            }

            (await askForConfirmation(
                `Are you sure you want to reset exercise ${exerciseData.val.name}?`,
                true,
            ))
                ? resetExercise(actionContext, exerciseId)
                : showNotification(`Reset canceled for exercise ${exerciseData.val.name}.`);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("closeExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                vscode.window.showErrorMessage(
                    "Currently open editor is not part of a TMC exercise",
                );
                return;
            }
            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (exerciseData.err) {
                vscode.window.showErrorMessage("The data for this exercise seems to be missing");
                return;
            }
            if (userData.getPassed(exerciseId)) {
                workspaceManager.closeExercise(exerciseId);
                return;
            }
            (await askForConfirmation(
                `Are you sure you want to close uncompleted exercise ${exerciseData.val.name}?`,
            ))
                ? workspaceManager.closeExercise(exerciseId)
                : showNotification(`Close canceled for exercise ${exerciseData.val.name}.`);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("moveExercises", async () => {
            const old = vscode.workspace
                .getConfiguration()
                .get("TMC.exercisePath.exerciseDownloadPath") as string;
            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: "Select folder",
            };
            vscode.window.showOpenDialog(options).then((url) => {
                const conf = vscode.workspace.getConfiguration();
                const os = process.platform;
                if (url && old) {
                    let newPath = path.join(url[0].path, "/tmcdata");
                    newPath = os.includes("win") ? newPath.slice(1) : newPath;
                    workspaceManager.moveFolder(old, newPath);
                    conf.update("TMC.exercisePath.exerciseDownloadPath", newPath, true);
                }
                conf.update("TMC.exercisePath.changeExerciseDownloadPath", false, true);
            });
        }),
    );
}
