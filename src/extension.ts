import * as vscode from "vscode";
import * as init from "./init";

import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import { validateAndFix } from "./config/validate";
import UI from "./ui/ui";
import {
    checkFreeDiskSpace,
    isWorkspaceOpen,
    showNotification,
    superfluousPropertiesEnabled,
} from "./utils/";
import { checkForExerciseUpdates, checkForNewExercises } from "./actions";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const productionMode = superfluousPropertiesEnabled();
    console.log(`Starting extension in ${productionMode ? "production" : "development"} mode.`);

    const storage = new Storage(context);
    const resourcesResult = await init.resourceInitialization(context, storage);
    if (resourcesResult.err) {
        vscode.window.showErrorMessage(
            "TestMyCode Initialization failed: " + resourcesResult.val.message,
        );
        return;
    }

    await vscode.commands.executeCommand("setContext", "tmcWorkspaceActive", true);

    const resources = resourcesResult.val;

    /**
     * Checks whether the necessary folders are open in the workspace and opens them if they aren't.
     */
    if (isWorkspaceOpen(resources)) {
        vscode.workspace.updateWorkspaceFolders(
            vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0,
            null,
            { uri: vscode.Uri.file(resources.getExercisesFolderPath()) },
        );
    }

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
    const freeSpace = await checkFreeDiskSpace(actionContext.resources.getDataPath());
    console.log(freeSpace);

    if (freeSpace.err) {
        showNotification(freeSpace.val.message);
    } else {
        if (freeSpace.val < 1000000000) {
            showNotification(
                "WARNING! Currently available space less than 1Gb. Available space: " +
                    (freeSpace.val / 1000000000).toFixed(2) +
                    "Gb",
            );
        } else {
            showNotification(
                "Currently available space: " + (freeSpace.val / 1000000000).toFixed(2) + "Gb",
            );
        }
    }
}

export function deactivate(): void {}
