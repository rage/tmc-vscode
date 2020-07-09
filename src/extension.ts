import * as vscode from "vscode";

import { checkForExerciseUpdates, checkForNewExercises } from "./actions";
import TMC from "./api/tmc";
import VSC, { showError } from "./api/vscode";
import WorkspaceManager from "./api/workspaceManager";
import { EXERCISE_CHECK_INTERVAL } from "./config/constants";
import Settings from "./config/settings";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import { validateAndFix } from "./config/validate";
import { ApiError } from "./errors";
import * as init from "./init";
import TemporaryWebviewProvider from "./ui/temporaryWebviewProvider";
import UI from "./ui/ui";
import { Logger, LogLevel } from "./utils/logger";

let maintenanceInterval: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    Logger.configure(LogLevel.Verbose);
    Logger.log(`Starting extension in "${process.env.DEBUG_MODE || "production"}" mode.`);
    Logger.error("Test", new ApiError("Unexpected error"));
    const storage = new Storage(context);

    const resourcesResult = await init.resourceInitialization(context, storage);
    if (resourcesResult.err) {
        const message = `TestMyCode Initialization failed: ${resourcesResult.val}`;
        Logger.error(message);
        showError(message);
        return;
    }
    const resources = resourcesResult.val;

    const settingsResult = await init.settingsInitialization(storage, resources);
    const settings = new Settings(storage, Logger, settingsResult, resources);
    Logger.configure(settings.getLogLevel());

    const vsc = new VSC(settings);
    await vsc.activate();

    Logger.log(`VSCode version: ${vsc.getVSCodeVersion()}`);
    Logger.log(`TMC extension version: ${resources.extensionVersion}`);
    Logger.log(`Python extension version: ${vsc.getExtensionVersion("ms-python.python")}`);

    const ui = new UI(context, resources, vscode.window.createStatusBarItem());
    const tmc = new TMC(storage, resources);

    const validationResult = await validateAndFix(storage, tmc, ui, resources);
    if (validationResult.err) {
        const message = `Data reconstruction failed: ${validationResult.val.message}`;
        Logger.error(message);
        showError(message);
        return;
    }

    const workspaceManager = new WorkspaceManager(storage, resources);
    tmc.setWorkspaceManager(workspaceManager);
    const userData = new UserData(storage);
    const temporaryWebviewProvider = new TemporaryWebviewProvider(resources, ui);
    const actionContext = {
        resources,
        settings,
        temporaryWebviewProvider,
        tmc,
        vsc,
        ui,
        userData,
        workspaceManager,
    };

    init.registerUiActions(actionContext);
    init.registerCommands(context, actionContext);

    checkForExerciseUpdates(actionContext);
    checkForNewExercises(actionContext);

    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
    }

    maintenanceInterval = setInterval(() => {
        checkForExerciseUpdates(actionContext);
        checkForNewExercises(actionContext);
    }, EXERCISE_CHECK_INTERVAL);
}

export function deactivate(): void {
    maintenanceInterval && clearInterval(maintenanceInterval);
}
