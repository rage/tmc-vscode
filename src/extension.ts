import * as vscode from "vscode";

import { checkForExerciseUpdates, checkForNewExercises } from "./actions";
import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import { EXERCISE_CHECK_INTERVAL } from "./config/constants";
import Settings from "./config/settings";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import { validateAndFix } from "./config/validate";
import * as init from "./init";
import TemporaryWebviewProvider from "./ui/temporaryWebviewProvider";
import UI from "./ui/ui";
import { showError } from "./utils/";
import Logger from "./utils/logger";

let maintenanceInterval: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const logger = new Logger();
    logger.log(`Starting extension in "${process.env.DEBUG_MODE || "production"}" mode.`);
    const storage = new Storage(context);
    const resourcesResult = await init.resourceInitialization(context, storage, logger);
    if (resourcesResult.err) {
        const message = `TestMyCode Initialization failed: ${resourcesResult.val}`;
        logger.error(message);
        showError(message);
        return;
    }
    const resources = resourcesResult.val;

    const settingsResult = await init.settingsInitialization(storage, resources, logger);
    const settings = new Settings(storage, logger, settingsResult, resources);
    logger.setLogLevel(settings.getLogLevel());
    await vscode.commands.executeCommand("setContext", "tmcWorkspaceActive", true);

    logger.log(`VSCode version: ${vscode.version}`);
    logger.log(`TMC extension version: ${resources.extensionVersion}`);
    logger.log(
        `Python extension version: ${
            vscode.extensions.getExtension("ms-python.python")?.packageJSON.version
        }`,
    );

    const ui = new UI(context, resources, vscode.window.createStatusBarItem());

    const tmc = new TMC(storage, resources, logger);
    const validationResult = await validateAndFix(storage, tmc, ui, resources, logger);
    if (validationResult.err) {
        const message = `Data reconstruction failed: ${validationResult.val.message}`;
        logger.error(message);
        showError(message);
        return;
    }

    const workspaceManager = new WorkspaceManager(storage, resources, logger);
    tmc.setWorkspaceManager(workspaceManager);
    const userData = new UserData(storage, logger);
    const temporaryWebviewProvider = new TemporaryWebviewProvider(resources, ui);
    const actionContext = {
        logger,
        resources,
        settings,
        temporaryWebviewProvider,
        tmc,
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
