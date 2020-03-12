import * as vscode from "vscode";
import * as init from "./init";

import { openWorkspace, resetExercise, submitExercise, testExercise } from "./actions";
import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import UI from "./ui/ui";
import { askForConfirmation, getCurrentExerciseId, isProductionBuild } from "./utils";

export async function activate(context: vscode.ExtensionContext) {
    const productionMode = isProductionBuild();
    console.log(`Starting extension in ${productionMode ? "production" : "development"} mode.`);

    const result = await init.firstTimeInitialization(context);
    if (result.err) {
        vscode.window.showErrorMessage("TestMyCode Initialization failed: " + result.val.message);
        return;
    }

    await vscode.commands.executeCommand("setContext", "tmcWorkspaceActive", true);

    const resources = result.val;
    const ui = new UI(context, resources, vscode.window.createStatusBarItem());
    const storage = new Storage(context);
    const workspaceManager = new WorkspaceManager(storage, resources);
    const tmc = new TMC(workspaceManager, storage, resources);
    const userData = new UserData(storage);

    init.registerUiActions(ui, storage, tmc, workspaceManager, resources, userData);

    const actionContext = { ui, resources, workspaceManager, tmc, userData };

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

            await askForConfirmation(`Are you sure you want to reset exercise ${exerciseData.val.name}?`)
                ? resetExercise(exerciseId, actionContext)
                : vscode.window.showInformationMessage(`Reset canceled for exercise ${exerciseData.val.name}.`);
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
            await askForConfirmation(`Are you sure you want to close uncompleted exercise ${exerciseData.val.name}?`)
                ? workspaceManager.closeExercise(exerciseId)
                : vscode.window.showInformationMessage(`Close canceled for exercise ${exerciseData.val.name}.`);
        }),
    );
}

export function deactivate() { }
