// All access to VSCode's storage should be done through this module.
import Dialog from "../api/dialog";
import TMC from "../api/tmc";
import {
    WORKSPACE_ROOT_FILE_NAME,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_ROOT_FOLDER_NAME,
    WORKSPACE_SETTINGS,
} from "../config/constants";
import { HaltForReloadError } from "../errors";
import { v2 as storage, v0 } from "./data";
import migrateExerciseDataToLatest from "./migration/exerciseData";
import migrateExtensionSettingsToLatest from "./migration/extensionSettings";
import migrateSessionState from "./migration/sessionState";
import migrateUserDataToLatest from "./migration/userData";
import * as fs from "fs-extra";
import { concat, last } from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
    private _context: vscode.ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    public getUserData(): storage.UserData | undefined {
        return this._context.globalState.get<storage.UserData>(storage.USER_DATA_KEY);
    }

    /**
     * @deprecated Extension Settings will be stored in VSCode, remove on major 3.0 release.
     */
    public getExtensionSettings(): storage.ExtensionSettings | undefined {
        return this._context.globalState.get<storage.ExtensionSettings>(
            storage.EXTENSION_SETTINGS_KEY,
        );
    }

    public getSessionState(): storage.SessionState | undefined {
        return this._context.globalState.get<storage.SessionState>(storage.SESSION_STATE_KEY);
    }

    public async updateUserData(userData: storage.UserData | undefined): Promise<void> {
        await this._context.globalState.update(storage.USER_DATA_KEY, userData);
    }

    public async updateExtensionSettings(
        settings: storage.ExtensionSettings | undefined,
    ): Promise<void> {
        await this._context.globalState.update(storage.EXTENSION_SETTINGS_KEY, settings);
    }

    public async updateSessionState(sessionState: storage.SessionState | undefined): Promise<void> {
        await this._context.globalState.update(storage.SESSION_STATE_KEY, sessionState);
    }

    public async wipeStorage(): Promise<void> {
        await this.updateExtensionSettings(undefined);
        await this.updateSessionState(undefined);
        await this.updateUserData(undefined);
    }

    public async migrateToLatest(
        context: vscode.ExtensionContext,
        dialog: Dialog,
        tmc: TMC,
        settings: vscode.WorkspaceConfiguration,
    ): Promise<Result<void, Error>> {
        const memento = context.globalState;

        const activeOldWorkspaceName = getActiveOldWorkspaceName(context.globalState);
        if (activeOldWorkspaceName) {
            const workspaceFileFolder = path.join(context.globalStoragePath, "workspaces");
            createInitializationFiles(workspaceFileFolder, activeOldWorkspaceName);
            await vscode.commands.executeCommand(
                "vscode.openFolder",
                vscode.Uri.file(path.join(workspaceFileFolder, activeOldWorkspaceName)),
            );
            return Err(new HaltForReloadError("Restart to start migration."));
        }

        try {
            const migratedExtensionSettings = await migrateExtensionSettingsToLatest(
                memento,
                settings,
            );
            const migratedSessionState = migrateSessionState(memento);
            const migratedUserData = migrateUserDataToLatest(memento);

            // Workspace data migration - this one is a bit more tricky so do it last.
            const migratedExerciseData = await migrateExerciseDataToLatest(memento, dialog, tmc);

            await this.updateExtensionSettings(migratedExtensionSettings.data);
            await this.updateSessionState(migratedSessionState.data);
            await this.updateUserData(migratedUserData.data);

            const keysToRemove = concat(
                migratedExerciseData.obsoleteKeys,
                migratedExtensionSettings.obsoleteKeys,
                migratedSessionState.obsoleteKeys,
                migratedUserData.obsoleteKeys,
            );
            for (const key of keysToRemove) {
                await memento.update(key, undefined);
            }
        } catch (e) {
            // Typing change from update
            return Err(e as Error);
        }

        return Ok.EMPTY;
    }
}

function getActiveOldWorkspaceName(memento: vscode.Memento): string | undefined {
    interface ExtensionSettingsPartial {
        dataPath: string;
    }

    const workspaceFile = vscode.workspace.workspaceFile;
    const dataPath = memento.get<ExtensionSettingsPartial>(v0.EXTENSION_SETTINGS_KEY)?.dataPath;

    if (!workspaceFile || !dataPath) {
        return undefined;
    }

    return path.relative(workspaceFile.fsPath, vscode.Uri.file(dataPath).fsPath) ===
        path.join("..", "..")
        ? last(workspaceFile?.fsPath.split(path.sep))
        : undefined;
}

// Copypaste code from resource initialization because that code isn't accessed yet.
function createInitializationFiles(workspaceFileFolder: string, workspaceName: string): void {
    fs.ensureDirSync(workspaceFileFolder);

    const workspaceFile = path.join(workspaceFileFolder, workspaceName);
    fs.writeFileSync(workspaceFile, JSON.stringify(WORKSPACE_SETTINGS));

    const rootFolder = path.join(workspaceFileFolder, WORKSPACE_ROOT_FOLDER_NAME);
    fs.ensureDirSync(rootFolder);

    const rootFile = path.join(rootFolder, WORKSPACE_ROOT_FILE_NAME);
    fs.writeFileSync(rootFile, WORKSPACE_ROOT_FILE_TEXT);
}
