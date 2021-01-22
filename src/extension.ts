import * as path from "path";
import * as vscode from "vscode";

import { checkForCourseUpdates, refreshLocalExercises } from "./actions";
import Storage from "./api/storage";
import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import {
    CLIENT_NAME,
    DEBUG_MODE,
    EXERCISE_CHECK_INTERVAL,
    EXTENSION_ID,
    TMC_LANGS_CONFIG_DIR,
    TMC_LANGS_ROOT_URL,
} from "./config/constants";
import Settings from "./config/settings";
import { UserData } from "./config/userdata";
import { EmptyLangsResponseError } from "./errors";
import * as init from "./init";
import { migrateExtensionDataFromPreviousVersions } from "./migrate";
import TemporaryWebviewProvider from "./ui/temporaryWebviewProvider";
import UI from "./ui/ui";
import { Logger, LogLevel, semVerCompare } from "./utils";
import { showError } from "./window";

let maintenanceInterval: NodeJS.Timeout | undefined;

function throwFatalError(error: Error, cliFolder: string): never {
    if (error instanceof EmptyLangsResponseError) {
        Logger.error(
            "The above error may have been caused by an interfering antivirus program. " +
                "Please add an exception for the following folder:",
            cliFolder,
        );
    }

    showError("TestMyCode initialization failed. Please see logs for details.");
    Logger.show();
    throw error;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version;

    Logger.configure(LogLevel.Verbose);
    Logger.log(`Starting ${EXTENSION_ID} in "${DEBUG_MODE ? "development" : "production"}" mode.`);
    Logger.log(`VS Code version: ${vscode.version}`);
    Logger.log(`${EXTENSION_ID} version: ${extensionVersion}`);
    Logger.log(`Currently open workspace: ${vscode.workspace.name}`);

    const cliFolder = path.join(context.globalStoragePath, "cli");
    const cliPathResult = await init.downloadCorrectLangsVersion(cliFolder);
    if (cliPathResult.err) {
        throwFatalError(cliPathResult.val, cliFolder);
    }

    const tmc = new TMC(cliPathResult.val, CLIENT_NAME, extensionVersion, TMC_LANGS_ROOT_URL, {
        cliConfigDir: TMC_LANGS_CONFIG_DIR,
    });

    const authenticatedResult = await tmc.isAuthenticated();
    if (authenticatedResult.err) {
        Logger.error("Failed to check if authenticated:", authenticatedResult.val.message);
        throwFatalError(authenticatedResult.val, cliFolder);
    }

    const authenticated = authenticatedResult.val;
    await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", authenticated);

    const storage = new Storage(context);
    const migrationResult = await migrateExtensionDataFromPreviousVersions(context, storage, tmc);
    if (migrationResult.err) {
        throwFatalError(migrationResult.val, cliFolder);
    }

    const dataPathResult = await tmc.getSetting("projects-dir");
    if (dataPathResult.err) {
        Logger.error("Failed to define datapath:", dataPathResult.val);
        throwFatalError(dataPathResult.val, cliFolder);
    }

    const tmcDataPath = dataPathResult.val;
    const workspaceFileFolder = path.join(context.globalStoragePath, "workspaces");
    const resourcesResult = await init.resourceInitialization(
        context,
        storage,
        tmcDataPath,
        workspaceFileFolder,
    );
    if (resourcesResult.err) {
        Logger.error("Resource initialization failed: ", resourcesResult.val);
        throwFatalError(resourcesResult.val, cliFolder);
    }

    const resources = resourcesResult.val;
    await init.settingsInitialization(storage);
    const settings = new Settings(storage, resources);
    await settings.verifyWorkspaceSettingsIntegrity();
    Logger.configure(settings.getLogLevel());

    const ui = new UI(context, resources, vscode.window.createStatusBarItem());
    const loggedIn = ui.treeDP.createVisibilityGroup(authenticated);
    const visibilityGroups = {
        loggedIn,
    };
    tmc.on("login", async () => {
        await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", true);
        ui.treeDP.updateVisibility([visibilityGroups.loggedIn]);
    });
    tmc.on("logout", async () => {
        await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", false);
        ui.treeDP.updateVisibility([visibilityGroups.loggedIn.not]);
        ui.webview.setContentFromTemplate({ templateName: "login" });
    });

    await vscode.commands.executeCommand("setContext", "test-my-code:WorkspaceActive", true);

    const currentVersion = resources.extensionVersion;
    const previousState = storage.getSessionState();
    const previousVersion = previousState?.extensionVersion;
    if (currentVersion !== previousVersion) {
        storage.updateSessionState({ extensionVersion: currentVersion });
    }

    const userData = new UserData(storage);
    const workspaceManager = new WorkspaceManager(resources);
    context.subscriptions.push(workspaceManager);
    const temporaryWebviewProvider = new TemporaryWebviewProvider(resources, ui);
    const actionContext = {
        resources,
        settings,
        temporaryWebviewProvider,
        tmc,
        ui,
        userData,
        workspaceManager,
        visibilityGroups,
    };

    const refreshResult = await refreshLocalExercises(actionContext);
    if (refreshResult.err) {
        Logger.warn("Failed to set initial exercises.", refreshResult.val);
    }

    init.registerUiActions(actionContext);
    init.registerCommands(context, actionContext);

    if (authenticated) {
        vscode.commands.executeCommand("tmc.updateExercises", "silent");
        checkForCourseUpdates(actionContext);
    }

    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
    }

    maintenanceInterval = setInterval(async () => {
        const authenticated = await tmc.isAuthenticated();
        if (authenticated.err) {
            Logger.error("Failed to check if authenticated", authenticated.val.message);
        } else if (authenticated.val) {
            vscode.commands.executeCommand("tmc.updateExercises", "silent");
            checkForCourseUpdates(actionContext);
        }
        await vscode.commands.executeCommand(
            "setContext",
            "test-my-code:LoggedIn",
            authenticated.val,
        );
    }, EXERCISE_CHECK_INTERVAL);

    const versionDiff = semVerCompare(currentVersion, previousVersion || "", "minor");
    if (versionDiff === undefined || versionDiff > 0) {
        await vscode.commands.executeCommand("tmc.showWelcome");
    }
}

export function deactivate(): void {
    maintenanceInterval && clearInterval(maintenanceInterval);
}
