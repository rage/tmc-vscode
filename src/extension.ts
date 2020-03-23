import * as vscode from "vscode";
import * as init from "./init";

import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import { validateAndFix } from "./config/validate";
import UI from "./ui/ui";
import { isProductionBuild } from "./utils";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const productionMode = isProductionBuild();
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

    // Uncomment this to test the new reconstruction functionality
    /*
    storage.updateExerciseData(storage.getExerciseData()?.map((x) => {
        x.deadline = undefined as unknown as string;
        return x;
    }));

    const userd = storage.getUserData();
    if (userd) {
        userd.courses = userd.courses.map((x) => ({id: x.id, organization: x.organization} as LocalCourseData));
        storage.updateUserData(userd);
    }
    */

    const tmcTemp = new TMC((undefined as unknown) as WorkspaceManager, storage, resources);
    const validationResult = await validateAndFix(storage, tmcTemp, ui, resources);
    if (validationResult.err) {
        vscode.window.showErrorMessage(
            "Data reconstruction failed: " + validationResult.val.message,
        );
        return;
    }

    const workspaceManager = new WorkspaceManager(storage, resources);
    const tmc = new TMC(workspaceManager, storage, resources);
    const userData = new UserData(storage);

    init.registerUiActions(ui, storage, tmc, workspaceManager, resources, userData);
    const actionContext = { ui, resources, workspaceManager, tmc, userData };
    init.registerCommands(context, actionContext);
}

export function deactivate(): void {}
