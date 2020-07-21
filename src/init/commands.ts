import * as vscode from "vscode";

import {
    closeExercises,
    downloadOldSubmissions,
    openExercises,
    pasteExercise,
    resetExercise,
    selectAction,
    submitExercise,
    testExercise,
} from "../actions";
import { ActionContext } from "../actions/types";
import { askForConfirmation, showError, showNotification } from "../api/vscode";
import { getCurrentExerciseData, getCurrentExerciseId, Logger } from "../utils/";

// TODO: Fix error handling so user receives better error messages.
const errorMessage = "Currently open editor is not part of a TMC exercise";

export function registerCommands(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
): void {
    const { ui, workspaceManager, userData } = actionContext;
    Logger.log("Registering TMC VSCode commands");

    context.subscriptions.push(
        vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("selectAction", async () => {
            const exerciseData = getCurrentExerciseData(workspaceManager);
            if (exerciseData.err) {
                Logger.error(exerciseData.val.message);
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
                Logger.error(errorMessage);
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
                Logger.error(errorMessage);
                showError(errorMessage);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("runTests", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                Logger.error(errorMessage);
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
                Logger.error(errorMessage);
                showError(errorMessage);
                return;
            }
            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (exerciseData.err) {
                Logger.error("The data for this exercise seems to be missing");
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
            await openExercises(actionContext, [exerciseId], exerciseData.val.course);

            if (editor && resource) {
                vscode.commands.executeCommand<undefined>(
                    "vscode.open",
                    resource,
                    editor.viewColumn,
                );
            } else {
                Logger.warn(`Active file for exercise ${exerciseId} returned undefined?`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("downloadOldSubmission", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                Logger.error(errorMessage);
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
                Logger.warn(`Active file for exercise ${exerciseId} returned undefined?`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("closeExercise", async () => {
            const exerciseId = getCurrentExerciseId(workspaceManager);
            if (!exerciseId) {
                Logger.error(errorMessage);
                showError(errorMessage);
                return;
            }

            const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
            if (exerciseData.err) {
                Logger.error("The data for this exercise seems to be missing");
                showError("The data for this exercise seems to be missing");
                return;
            }
            if (
                userData.getPassed(exerciseId) ||
                (await askForConfirmation(
                    `Are you sure you want to close uncompleted exercise ${exerciseData.val.name}?`,
                ))
            ) {
                const result = await closeExercises(
                    actionContext,
                    [exerciseId],
                    exerciseData.val.course,
                );
                if (result.err) {
                    Logger.error(result.val.message);
                    showError(result.val.message);
                }
            }
        }),
    );
}
