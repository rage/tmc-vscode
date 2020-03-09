import * as vscode from "vscode";
import * as init from "./init";

import { resetExercise, submitExercise, testExercise } from "./actions/actions";
import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import UI from "./ui/ui";
import { askForConfirmation, getCurrentExerciseId } from "./utils";

export async function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "tmc-vscode" is now active!');

    const result = await init.firstTimeInitialization(context);
    if (result.ok) {
        const resources = result.val;
        const currentWorkspaceFile = vscode.workspace.workspaceFile;
        const tmcWorkspaceFile = vscode.Uri.file(resources.tmcWorkspaceFilePath);

        if (currentWorkspaceFile?.toString() !== tmcWorkspaceFile.toString()) {
            console.log("Current workspace:", currentWorkspaceFile);
            console.log("TMC workspace:", tmcWorkspaceFile);
            const confirmOpen = () => new Promise<boolean>((resolve) => {
                askForConfirmation("Do you want to open TMC workspace and close the current one?",
                    () => resolve(true),
                    () => resolve(false));
            });
            if (!currentWorkspaceFile || await confirmOpen()) {
                await vscode.commands.executeCommand("vscode.openFolder", tmcWorkspaceFile);
            } else {
                vscode.window.showErrorMessage("Please close your current workspace before using TestMyCode.");
                return;
            }
        }

        await vscode.commands.executeCommand("setContext", "tmcWorkspaceActive", true);

        const ui = new UI(context, resources, vscode.window.createStatusBarItem());
        const storage = new Storage(context);
        const workspaceManager = new WorkspaceManager(storage, resources);
        const tmc = new TMC(workspaceManager, storage, resources);
        const userData = new UserData(storage);

        init.registerUiActions(ui, storage, tmc, workspaceManager, resources, userData);

        const actionContext = {ui, resources, workspaceManager, tmc, userData};

        context.subscriptions.push(
            vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("uploadArchive", async () => {
                const exerciseId = getCurrentExerciseId(workspaceManager);
                exerciseId ? submitExercise(exerciseId, actionContext)
                    : vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("runTests", async () => {
                const exerciseId = getCurrentExerciseId(workspaceManager);
                exerciseId ? testExercise(exerciseId, actionContext)
                    : vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("resetExercise", async () => {
                const exerciseId = getCurrentExerciseId(workspaceManager);
                if (!exerciseId) {
                    vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
                    return;
                }
                const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
                if (exerciseData.err) {
                    vscode.window.showErrorMessage("The data for this exercise seems to be missing");
                    return;
                }
                askForConfirmation(`Are you sure you want to reset exercise ${exerciseData.val.name}?`,
                    () => resetExercise(exerciseId, actionContext),
                    () => vscode.window.showInformationMessage(`Reset canceled for exercise ${exerciseData.val.name}.`),
                );
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("closeExercise", async () => {
                const exerciseId = getCurrentExerciseId(workspaceManager);
                if (!exerciseId) {
                    vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
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
                askForConfirmation(`Are you sure you want to close uncompleted exercise ${exerciseData.val.name}?`,
                    () => workspaceManager.closeExercise(exerciseId),
                    () => vscode.window.showInformationMessage(`Close canceled for exercise ${exerciseData.val.name}.`),
                );
            }),
        );
    } else {
        vscode.window.showErrorMessage("Something broke: " + result.val.message);
    }
}

export function deactivate() { }
