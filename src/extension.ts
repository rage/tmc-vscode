import * as fs from "fs-extra";
import * as path from "path";
import * as vscode from "vscode";

import { checkForCourseUpdates } from "./actions";
import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import { DEBUG_MODE, EXERCISE_CHECK_INTERVAL } from "./config/constants";
import Settings from "./config/settings";
import Storage from "./config/storage";
import { UserData } from "./config/userdata";
import { validateAndFix } from "./config/validate";
import * as init from "./init";
import TemporaryWebviewProvider from "./ui/temporaryWebviewProvider";
import UI from "./ui/ui";
import { Logger, LogLevel, semVerCompare } from "./utils";
import { showError } from "./window";

let maintenanceInterval: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    Logger.configure(LogLevel.Verbose);
    Logger.log(`Starting extension in "${DEBUG_MODE ? "development" : "production"}" mode.`);

    const storage = new Storage(context);

    const resourcesResult = await init.resourceInitialization(context, storage);
    if (resourcesResult.err) {
        const message = "TestMyCode Initialization failed.";
        Logger.error(message, resourcesResult.val);
        showError(message);
        return;
    }
    const resources = resourcesResult.val;

    const settingsResult = await init.settingsInitialization(storage, resources);
    const settings = new Settings(storage, settingsResult, resources);
    await settings.verifyWorkspaceSettingsIntegrity();
    Logger.configure(settings.getLogLevel());

    await vscode.commands.executeCommand("setContext", "test-my-code:WorkspaceActive", true);

    const currentVersion = resources.extensionVersion;
    const previousVersion = storage.getExtensionVersion();
    if (currentVersion !== previousVersion) {
        storage.updateExtensionVersion(currentVersion);
    }

    Logger.log(`VSCode version: ${vscode.version}`);
    Logger.log(`TMC extension version: ${resources.extensionVersion}`);
    Logger.log(`Currently open workspace: ${vscode.workspace.name}`);

    const ui = new UI(context, resources, vscode.window.createStatusBarItem());
    const tmc = new TMC(resources);

    const validationResult = await validateAndFix(storage, tmc, ui, resources);
    if (validationResult.err) {
        const message = "Data reconstruction failed.";
        Logger.error(message, validationResult.val);
        showError(message);
        return;
    }

    const authenticated = await tmc.isAuthenticated();
    if (authenticated.err) {
        showError("Failed to check if authenticated");
        Logger.error("Failed to check if authenticated", authenticated.val.message);
        Logger.show();
        return;
    }
    await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", authenticated.val);
    const LOGGED_IN = ui.treeDP.createVisibilityGroup(authenticated.val);
    const visibilityGroups = {
        LOGGED_IN,
    };

    tmc.on("login", async () => {
        await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", true);
        ui.treeDP.updateVisibility([visibilityGroups.LOGGED_IN]);
    });
    tmc.on("logout", async () => {
        await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", false);
        ui.treeDP.updateVisibility([visibilityGroups.LOGGED_IN.not]);
    });

    const workspaceManager = new WorkspaceManager(storage, resources);
    await workspaceManager.initialize();

    const userData = new UserData(storage);
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

    // Migration plan to move all exercises from closed-exercises
    // Remove in 2.0.0 from here
    const allExerciseData = workspaceManager.getAllExercises();
    const oldTMCWorkspace = path.join(
        resources.getWorkspaceFolderPath(),
        "TMC Exercises.code-workspace",
    );
    const closedPath = path.join(resources.getDataPath(), "closed-exercises");
    if (fs.existsSync(oldTMCWorkspace)) {
        fs.removeSync(oldTMCWorkspace);
    }
    if (fs.existsSync(closedPath) && fs.readdirSync(closedPath).length !== 0) {
        allExerciseData?.forEach(async (ex) => {
            const closedPath = path.join(
                resources.getDataPath(),
                "closed-exercises",
                ex.id.toString(),
            );
            const openPath = path.join(
                resources.getExercisesFolderPath(),
                ex.organization,
                ex.course,
                ex.name,
            );
            if (fs.existsSync(closedPath)) {
                const ok = await workspaceManager.moveFolder(closedPath, openPath);
                if (ok.err) {
                    const message = "Error while moving folders.";
                    Logger.error(message, ok.val);
                    showError(message);
                }
            }
        });
    } else {
        fs.removeSync(closedPath);
    }
    // Remove in 2.0.0 to here

    // Start watcher after migration.
    workspaceManager.startWatcher();

    init.registerUiActions(actionContext);
    init.registerCommands(context, actionContext);

    if (authenticated.val) {
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

    init.watchForWorkspaceChanges(actionContext);

    const versionDiff = semVerCompare(currentVersion, previousVersion || "", "minor");
    if (versionDiff === undefined || versionDiff > 0) {
        await vscode.commands.executeCommand("tmc.showWelcome");
    }
}

export function deactivate(): void {
    maintenanceInterval && clearInterval(maintenanceInterval);
}
