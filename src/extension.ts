import * as fs from "fs-extra";
import path = require("path");
import * as vscode from "vscode";

import { checkForExerciseUpdates, checkForNewExercises, openSettings } from "./actions";
import TMC from "./api/tmc";
import VSC, { showError, showNotification } from "./api/vscode";
import WorkspaceManager from "./api/workspaceManager";
import { DEBUG_MODE, EXERCISE_CHECK_INTERVAL } from "./config/constants";
import Settings from "./config/settings";
import Storage from "./config/storage";
import { ExerciseStatus } from "./config/types";
import { UserData } from "./config/userdata";
import { validateAndFix } from "./config/validate";
import * as init from "./init";
import TemporaryWebviewProvider from "./ui/temporaryWebviewProvider";
import UI from "./ui/ui";
import { isCorrectWorkspaceOpen } from "./utils";
import { Logger, LogLevel } from "./utils/logger";

let maintenanceInterval: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    Logger.configure(LogLevel.Verbose);
    Logger.log(`Starting extension in "${DEBUG_MODE ? "development" : "production"}" mode.`);

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
    const settings = new Settings(storage, settingsResult, resources);
    Logger.configure(settings.getLogLevel());

    const vsc = new VSC(settings);
    await vsc.activate();

    const currentVersion = resources.extensionVersion;
    const previousVersion = storage.getExtensionVersion();
    if (currentVersion !== previousVersion) {
        storage.updateExtensionVersion(currentVersion);
    }

    Logger.log(`VSCode version: ${vsc.getVSCodeVersion()}`);
    Logger.log(`TMC extension version: ${resources.extensionVersion}`);
    Logger.log(`Python extension version: ${vsc.getExtensionVersion("ms-python.python")}`);
    Logger.log(`Currently open workspace: ${vscode.workspace.name}`);

    const ui = new UI(context, resources, vscode.window.createStatusBarItem());
    const tmc = new TMC(storage, resources);

    const validationResult = await validateAndFix(storage, tmc, ui, resources);
    if (validationResult.err) {
        const message = `Data reconstruction failed: ${validationResult.val.message}`;
        Logger.error(message);
        showError(message);
        return;
    }

    const workspaceManager = new WorkspaceManager(storage, resources, settings);
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

    // Migration plan to move all exercises from closed-exercises
    const allExerciseData = workspaceManager.getAllExercises();
    allExerciseData?.forEach(async (ex) => {
        const closedPath = path.join(resources.getClosedExercisesFolderPath(), ex.id.toString());
        const openPath = path.join(
            resources.getExercisesFolderPath(),
            ex.organization,
            ex.course,
            ex.name,
        );
        if (fs.existsSync(closedPath)) {
            const ok = await workspaceManager.moveFolder(closedPath, openPath);
            if (ok.err) {
                Logger.error("Error while moving", ok.val);
            }
        }
    });

    if (
        vscode.workspace.name &&
        isCorrectWorkspaceOpen(resources, vscode.workspace.name.split(" ")[0])
    ) {
        Logger.log("TMC Workspace identified, listening for folder changes.");
        vscode.workspace.onDidChangeWorkspaceFolders((listener) => {
            Logger.warn("Removed folders manually from workspace", listener);
            listener.removed.forEach((item) => {
                const exercise = workspaceManager.getExerciseDataByPath(item.uri.fsPath);
                if (
                    exercise.ok &&
                    exercise.val.status !== ExerciseStatus.MISSING &&
                    exercise.val.status === ExerciseStatus.OPEN
                ) {
                    workspaceManager.updateExercisesStatus(exercise.val.id, ExerciseStatus.CLOSED);
                    ui.webview.postMessage({
                        key: `exercise-${exercise.val.id}-status`,
                        message: {
                            command: "exerciseStatusChange",
                            exerciseId: exercise.val.id,
                            status: "closed",
                        },
                    });
                }
            });
            listener.added.forEach((item) => {
                const exercise = workspaceManager.getExerciseDataByPath(item.uri.fsPath);
                if (
                    exercise.ok &&
                    exercise.val.status !== ExerciseStatus.MISSING &&
                    exercise.val.status === ExerciseStatus.CLOSED
                ) {
                    workspaceManager.updateExercisesStatus(exercise.val.id, ExerciseStatus.OPEN);
                    ui.webview.postMessage({
                        key: `exercise-${exercise.val.id}-status`,
                        message: {
                            command: "exerciseStatusChange",
                            exerciseId: exercise.val.id,
                            status: "opened",
                        },
                    });
                }
            });
        });
    }

    if (settings.isInsider()) {
        Logger.warn("Using insider version.");
        if (currentVersion !== previousVersion) {
            showNotification(
                "A new version of the extension has been released. " +
                    "You are using the insider version of the TMC extension. " +
                    "This means you will receive new feature updates prior to their release. " +
                    "You can opt-out from insider version via our settings. ",
                ["OK", (): void => {}],
                ["Go to settings", (): Promise<void> => openSettings(actionContext)],
                [
                    "Read more...",
                    (): void =>
                        vsc.openUri(
                            "https://github.com/rage/tmc-vscode-documents/blob/master/insider.md",
                        ),
                ],
            );
        }
    }

    init.registerUiActions(actionContext);
    init.registerCommands(context, actionContext);

    if (tmc.isAuthenticated()) {
        checkForExerciseUpdates(actionContext);
        checkForNewExercises(actionContext);
    }

    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
    }

    maintenanceInterval = setInterval(() => {
        if (tmc.isAuthenticated()) {
            checkForExerciseUpdates(actionContext);
            checkForNewExercises(actionContext);
        }
    }, EXERCISE_CHECK_INTERVAL);
}

export function deactivate(): void {
    maintenanceInterval && clearInterval(maintenanceInterval);
}
