import * as vscode from "vscode";
import * as init from "./init";

import { resetExercise, submitExercise, testExercise } from "./actions/actions";
import ExerciseManager from "./api/exerciseManager";
import TMC from "./api/tmc";
import Storage from "./config/storage";
import UI from "./ui/ui";
import { getCurrentExerciseId } from "./utils";

export async function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "tmc-vscode" is now active!');

    const result = await init.firstTimeInitialization(context);
    if (result.ok) {

        const resources = result.val;

        const currentWorkspaceFile = vscode.workspace.workspaceFile;
        const tmcWorkspaceFile = vscode.Uri.file(resources.tmcWorkspaceFilePath);

        if (!currentWorkspaceFile) {
            await vscode.commands.executeCommand("vscode.openFolder", tmcWorkspaceFile);
        } else if (currentWorkspaceFile.toString() !== tmcWorkspaceFile.toString()) {
            console.log(currentWorkspaceFile);
            console.log(tmcWorkspaceFile);
            vscode.window.showErrorMessage("Wont't open TMC workspace while another workspace is open");
            return;
        }

        const ui = new UI(context, resources);
        const storage = new Storage(context);
        const exerciseManager = new ExerciseManager(storage, resources);
        const tmc = new TMC(exerciseManager, storage, resources);

        init.registerUiActions(ui, storage, tmc, exerciseManager, resources);

        const actionContext = {ui, resources, exerciseManager, tmc};

        context.subscriptions.push(
            vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("uploadArchive", async () => {
                const exerciseId = getCurrentExerciseId(exerciseManager);
                exerciseId ? submitExercise(exerciseId, actionContext)
                    : vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand("runTests", async () => {
                const exerciseId = getCurrentExerciseId(exerciseManager);
                exerciseId ? testExercise(exerciseId, actionContext)
                    : vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
            }),
        );

        const resetStatusbar = vscode.window.createStatusBarItem();

        context.subscriptions.push(
            vscode.commands.registerCommand("resetExercise", async () => {
                const exerciseId = getCurrentExerciseId(exerciseManager);
                exerciseId ? resetExercise(exerciseId, actionContext, resetStatusbar)
                    : vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
            }),
        );
    } else {
        vscode.window.showErrorMessage("Something broke: " + result.val.message);
    }
}

export function deactivate() { }
