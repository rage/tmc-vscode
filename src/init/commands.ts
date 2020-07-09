import * as vscode from "vscode";

import {
    closeExercises,
    downloadOldSubmissions,
    pasteExercise,
    resetExercise,
    selectAction,
    submitExercise,
    testExercise,
} from "../actions";
import { ActionContext } from "../actions/types";
import { askForConfirmation, showError, showNotification } from "../api/vscode";
import { getCurrentExerciseData, getCurrentExerciseId } from "../utils/";

// TODO: Fix error handling so user receives better error messages.
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
                logger.error(exerciseData.val.message);
                showError(exerciseData.val.message);
                return;
            }
            selectAction(actionContext, exerciseData.val);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("uploadArchive", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.error(errorMessage);
                showError(errorMessage);
                return;
            }
            submitExercise(actionContext, exerciseId);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("pasteExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (exerciseId) {
                const link = await pasteExercise(actionContext, exerciseId);
                link &&
                    showNotification(`Paste link: ${link}`, [
                        "Open URL",
                        (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(link)),
                    ]);
            } else {
                logger.error(errorMessage);
                showError(errorMessage);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("runTests", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.error(errorMessage);
                showError(errorMessage);
                return;
            }
            testExercise(actionContext, exerciseId);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("resetExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.error(errorMessage);
                showError(errorMessage);
                return;
            }
            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (exerciseData.err) {
                logger.error("The data for this exercise seems to be missing");
                showError("The data for this exercise seems to be missing");
                return;
            }

            if (
                !(await askForConfirmation(
                    `Are you sure you want to reset exercise ${exerciseData.val.name}?`,
                    false,
                ))
            ) {
                return;
            }

            const editor = vscode.window.activeTextEditor;
            const resource = editor?.document.uri;
            await resetExercise(actionContext, exerciseId);
            workspaceManager.openExercise(exerciseId);

            if (editor && resource) {
                vscode.commands.executeCommand<undefined>(
                    "vscode.open",
                    resource,
                    editor.viewColumn,
                );
            } else {
                logger.warn(`Active file for exercise ${exerciseId} returned undefined?`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("downloadOldSubmission", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.error(errorMessage);
                showError(errorMessage);
                return;
            }
            const editor = vscode.window.activeTextEditor;
            const resource = editor?.document.uri;
            await downloadOldSubmissions(actionContext, exerciseId);
            if (editor && resource) {
                vscode.commands.executeCommand<undefined>(
                    "vscode.open",
                    resource,
                    editor.viewColumn,
                );
            } else {
                logger.warn(`Active file for exercise ${exerciseId} returned undefined?`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("closeExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                logger.error(errorMessage);
                showError(errorMessage);
                return;
            }

            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (
                userData.getPassed(exerciseId) ||
                (await askForConfirmation(
                    `Are you sure you want to close uncompleted exercise ${exerciseData.val.name}?`,
                ))
            ) {
                const result = await closeExercises(actionContext, [exerciseId]);
                if (result.err) {
                    logger.error(result.val.message);
                    showError(result.val.message);
                }
            }
        }),
    );
}
