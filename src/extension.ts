import * as path from "path";
import { createIs } from "typia";
import * as vscode from "vscode";

import { checkForCourseUpdates, refreshLocalExercises } from "./actions";
import { ActionContext } from "./actions/types";
import Dialog from "./api/dialog";
import ExerciseDecorationProvider from "./api/exerciseDecorationProvider";
import TMC from "./api/tmc";
import WorkspaceManager from "./api/workspaceManager";
import {
    CLIENT_NAME,
    DEBUG_MODE,
    EXERCISE_CHECK_INTERVAL,
    EXTENSION_ID,
    TMC_LANGS_CONFIG_DIR,
} from "./config/constants";
import Settings from "./config/settings";
import { UserData } from "./config/userdata";
import { EmptyLangsResponseError, HaltForReloadError } from "./errors";
import * as init from "./init";
import { randomPanelId, TmcPanel } from "./panels/TmcPanel";
import UI from "./ui/ui";
import { cliFolder, Logger, LogLevel, semVerCompare } from "./utilities";
import { Err, Ok, Result } from "ts-results";
import Storage from "./storage";

let maintenanceInterval: NodeJS.Timeout | undefined;

function initializationError(dialog: Dialog, step: string, error: Error, cliFolder: string): void {
    Logger.errorWithDialog(
        dialog,
        `Initialization error during ${step}:`,
        error,
        "If this issue is not resolved, the extension may not function properly.",
    );
    if (error instanceof EmptyLangsResponseError) {
        Logger.error(
            "The above error may have been caused by an interfering antivirus program. " +
                "Please add an exception for the following folder:",
            cliFolder,
        );
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        await activateInner(context);
    } catch (e) {
        // this should never occur, we always want to activate the extension even if only partially
        Logger.error("Fatal error during initialization:", e);
        vscode.window.showErrorMessage(
            `Fatal error during TestMyCode extension initialization: ${e}`,
        );
        Logger.show();
    }
}

async function activateInner(context: vscode.ExtensionContext): Promise<void> {
    const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version;
    Logger.configure(LogLevel.Verbose);
    Logger.info(`Starting ${EXTENSION_ID} in "${DEBUG_MODE ? "development" : "production"}" mode.`);
    Logger.info(`${vscode.env.appName} version: ${vscode.version}`);
    Logger.info(`${EXTENSION_ID} version: ${extensionVersion}`);
    Logger.info(`Currently open workspace: ${vscode.workspace.name}`);

    const dialog = new Dialog();
    const cliFolderPath = cliFolder(context);
    const cliPathResult = await init.ensureLangsUpdated(cliFolderPath, dialog);

    // download langs if necessary
    let tmc: Result<TMC, Error>;
    if (cliPathResult.err) {
        tmc = cliPathResult;
        initializationError(dialog, "tmc-langs setup", cliPathResult.val, cliFolderPath);
    } else {
        tmc = new Ok(
            new TMC(cliPathResult.val, CLIENT_NAME, extensionVersion, {
                cliConfigDir: TMC_LANGS_CONFIG_DIR,
            }),
        );
    }

    // check auth status
    let authenticated = false;
    if (tmc.ok) {
        const authenticatedResult = await tmc.val.isAuthenticated({ timeout: 15000 });
        if (authenticatedResult.err) {
            initializationError(
                dialog,
                "authentication check",
                authenticatedResult.val,
                cliFolderPath,
            );
            await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", false);
        } else {
            authenticated = authenticatedResult.val;
            await vscode.commands.executeCommand(
                "setContext",
                "test-my-code:LoggedIn",
                authenticated,
            );
        }
    } else {
        Logger.warn("Could not check login status");
        await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", false);
    }

    // migrate data between versions
    const storage = new Storage(context);
    if (tmc.ok) {
        const migrationResult = await storage.migrateToLatest(
            context,
            dialog,
            tmc.val,
            vscode.workspace.getConfiguration(),
        );
        if (migrationResult.err) {
            if (migrationResult.val instanceof HaltForReloadError) {
                Logger.warn("Extension expected to restart", migrationResult.val);
                return;
            }

            initializationError(dialog, "migration", migrationResult.val, cliFolderPath);
        }
    } else {
        Logger.warn("Skipped data migration");
    }

    // get data path
    let tmcDataPath: string | undefined;
    if (tmc.ok) {
        const dataPathResult = await tmc.val.getSetting("projects-dir", createIs<string>());
        if (dataPathResult.err) {
            Logger.error("Failed to define datapath:", dataPathResult.val);
            initializationError(dialog, "finding datapath", dataPathResult.val, cliFolderPath);
        } else if (dataPathResult.val === undefined) {
            Logger.error("Failed to define datapath: no value found.");
            initializationError(
                dialog,
                "finding datapath",
                new Error("No value for datapath."),
                cliFolderPath,
            );
        } else {
            tmcDataPath = dataPathResult.val;
        }
    }

    const workspaceFileFolder = path.join(context.globalStorageUri.fsPath, "workspaces");
    const resources = await init.resourceInitialization(
        context,
        storage,
        tmcDataPath,
        workspaceFileFolder,
    );
    if (resources.err) {
        initializationError(dialog, "resource initialization", resources.val, cliFolderPath);
    }

    const settings = new Settings(storage);
    context.subscriptions.push(settings);

    Logger.configure(settings.getLogLevel());

    const ui = new UI();
    const loggedIn = ui.treeDP.createVisibilityGroup(authenticated);
    const visibilityGroups = {
        loggedIn,
    };

    if (tmc.ok) {
        tmc.val.on("login", async () => {
            await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", true);
            ui.treeDP.updateVisibility([visibilityGroups.loggedIn]);
        });
        tmc.val.on("logout", async () => {
            dialog.warningNotification("Your TMC session has expired, please log in.");
            await vscode.commands.executeCommand("setContext", "test-my-code:LoggedIn", false);
            ui.treeDP.updateVisibility([visibilityGroups.loggedIn.not]);
            TmcPanel.renderMain(context.extensionUri, context, actionContext, {
                type: "Login",
                id: randomPanelId(),
            });
        });
    } else {
        Logger.warn("Skipped login command setup");
    }

    let showWelcome = false;
    if (resources.ok) {
        const currentVersion = resources.val.extensionVersion;
        const previousState = storage.getSessionState();
        const previousVersion = previousState?.extensionVersion;
        if (currentVersion !== previousVersion) {
            storage.updateSessionState({ extensionVersion: currentVersion });
        }
        const versionDiff = semVerCompare(currentVersion, previousVersion || "", "minor");
        if (versionDiff === undefined || versionDiff > 0) {
            showWelcome = true;
        }
    } else {
        Logger.warn("Skipped version check");
    }

    let userData: Result<UserData, Error>;
    let workspaceManager: Result<WorkspaceManager, Error>;
    let exerciseDecorationProvider: Result<ExerciseDecorationProvider, Error>;
    if (resources.ok) {
        userData = new Ok(new UserData(storage));
        workspaceManager = new Ok(new WorkspaceManager(resources.val));
        context.subscriptions.push(workspaceManager.val);
        if (workspaceManager.val.activeCourse) {
            await vscode.commands.executeCommand(
                "setContext",
                "test-my-code:WorkspaceActive",
                true,
            );
            await workspaceManager.val.verifyWorkspaceSettingsIntegrity();
        }
        exerciseDecorationProvider = new Ok(
            new ExerciseDecorationProvider(userData.val, workspaceManager.val),
        );
    } else {
        Logger.warn("Skipped userdata setup");
        exerciseDecorationProvider = new Err(
            new Error(
                "Could not initialize exercise decoration provider due to failure in resource initialization",
            ),
        );
        userData = new Err(
            new Error(
                "Could not initialize exercise decoration provider due to failure in resource initialization",
            ),
        );
        workspaceManager = new Err(
            new Error(
                "Could not initialize exercise decoration provider due to failure in resource initialization",
            ),
        );
    }

    const actionContext: ActionContext = {
        dialog,
        exerciseDecorationProvider,
        resources,
        settings,
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
    init.registerSettingsCallbacks(actionContext);

    if (exerciseDecorationProvider.ok) {
        context.subscriptions.push(
            vscode.window.registerFileDecorationProvider(exerciseDecorationProvider.val),
        );
    }

    if (authenticated) {
        vscode.commands.executeCommand("tmc.updateExercises", "silent");
        checkForCourseUpdates(actionContext);
    }

    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
    }

    maintenanceInterval = setInterval(async () => {
        const authenticated = tmc.ok ? await tmc.val.isAuthenticated() : Ok(false);
        if (authenticated.err) {
            Logger.error("Failed to check if authenticated", authenticated.val);
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

    if (showWelcome) {
        await vscode.commands.executeCommand("tmc.showWelcome");
    }

    if (
        !(
            tmc.ok &&
            userData.ok &&
            workspaceManager.ok &&
            exerciseDecorationProvider.ok &&
            resources.ok
        )
    ) {
        TmcPanel.renderMain(context.extensionUri, context, actionContext, {
            id: randomPanelId(),
            type: "InitializationErrorHelp",
        });
    }
}

export function deactivate(): void {
    if (maintenanceInterval) {
        clearInterval(maintenanceInterval);
    }
}
