import * as vscode from "vscode";
import * as init from "./init";

import { resetExercise, submitExercise, testExercise } from "./actions/actions";
import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
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
        const workspaceManager = new WorkspaceManager(storage, resources);
        const tmc = new TMC(workspaceManager, storage, resources);
        const userData = new UserData(storage);
        const statusBar = vscode.window.createStatusBarItem();

        init.registerUiActions(ui, storage, tmc, workspaceManager, resources, userData, statusBar);

        const actionContext = {ui, resources, workspaceManager, tmc, userData, statusBar};

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
                exerciseId ? resetExercise(exerciseId, actionContext)
                    : vscode.window.showErrorMessage("Currently open editor is not part of a TMC exercise");
            }),
        );
    } else {
        vscode.window.showErrorMessage("Something broke: " + result.val.message);
    }
}

export function deactivate() { }
