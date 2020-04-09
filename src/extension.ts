import * as vscode from "vscode";
import * as init from "./init";

import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import { validateAndFix } from "./config/validate";
import UI from "./ui/ui";
import { superfluousPropertiesEnabled } from "./utils/";
import { checkForExerciseUpdates, checkForNewExercises } from "./actions";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const productionMode = superfluousPropertiesEnabled();
    console.log(`Starting extension in ${productionMode ? "production" : "development"} mode.`);

    const result = await init.resourceInitialization(context);
    if (result.err) {
        vscode.window.showErrorMessage("TestMyCode Initialization failed: " + result.val.message);
        return;
    }

    await vscode.commands.executeCommand("setContext", "tmcWorkspaceActive", true);

    const resources = result.val;
    const storage = new Storage(context);
    const ui = new UI(context, resources, vscode.window.createStatusBarItem());

    const tmc = new TMC(storage, resources);
    const validationResult = await validateAndFix(storage, tmc, ui, resources);
    if (validationResult.err) {
        vscode.window.showErrorMessage(
            "Data reconstruction failed: " + validationResult.val.message,
        );
        return;
    }

    const workspaceManager = new WorkspaceManager(storage, resources);
    tmc.setWorkspaceManager(workspaceManager);
    const userData = new UserData(storage);

    init.registerUiActions(ui, tmc, workspaceManager, resources, userData);
    const actionContext = { ui, resources, workspaceManager, tmc, userData };
    init.registerCommands(context, actionContext);

    checkForExerciseUpdates(actionContext);
    checkForNewExercises(actionContext);
}

export function deactivate(): void {}
