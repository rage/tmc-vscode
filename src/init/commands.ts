import * as vscode from "vscode";
import { ActionContext } from "../actions/types";
import {
    askForConfirmation,
    getCurrentExerciseData,
    getCurrentExerciseId,
    showNotification,
} from "../utils/";
import {
    downloadOldSubmissions,
    pasteExercise,
    resetExercise,
    selectAction,
    submitExercise,
    testExercise,
} from "../actions";

const errorMessage = "Currently open editor is not part of a TMC exercise";

export function registerCommands(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
): void {
    const { ui, workspaceManager, userData, logger } = actionContext;
    logger.log("Registering TMC VSCode commands");

    context.subscriptions.push(
        vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("selectAction", async () => {
            const exerciseData = getCurrentExerciseData(workspaceManager);
            if (exerciseData.err) {
                logger.showError(exerciseData.val.message);
                return;
            }
            selectAction(actionContext, exerciseData.val);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("uploadArchive", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            exerciseId ? submitExercise(actionContext, exerciseId) : logger.showError(errorMessage);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("pasteExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (exerciseId) {
                const link = await pasteExercise(actionContext, exerciseId);
                showNotification(`Paste to TMC Server successful: ${link}`, [
                    "Open URL",
                    (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(link)),
                ]);
            } else {
                logger.showError(errorMessage);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("runTests", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            exerciseId ? testExercise(actionContext, exerciseId) : logger.showError(errorMessage);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("resetExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.showError(errorMessage);
                return;
            }
            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (exerciseData.err) {
                logger.showError("The data for this exercise seems to be missing");
                return;
            }

            if (
                await askForConfirmation(
                    `Are you sure you want to reset exercise ${exerciseData.val.name}?`,
                    false,
                )
            ) {
                await resetExercise(actionContext, exerciseId);
                workspaceManager.openExercise(exerciseId);
            } else {
                showNotification(`Reset canceled for exercise ${exerciseData.val.name}.`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("downloadOldSubmission", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.showError(errorMessage);
                return;
            }
            downloadOldSubmissions(exerciseId, actionContext);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("closeExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.showError(errorMessage);
                return;
            }
            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (exerciseData.err) {
                logger.showError("The data for this exercise seems to be missing");
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
}
