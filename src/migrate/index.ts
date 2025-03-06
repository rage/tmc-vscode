import * as fs from "fs-extra";
import { concat, last } from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import Dialog from "../api/dialog";
import TMC from "../api/tmc";
import Storage from "../api/storage";
import {
    WORKSPACE_ROOT_FILE_NAME,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_ROOT_FOLDER_NAME,
    WORKSPACE_SETTINGS,
} from "../config/constants";
import { HaltForReloadError } from "../errors";

import migrateExerciseData from "./migrateExerciseData";
import migrateExtensionSettings from "./migrateExtensionSettings";
import migrateSessionState from "./migrateSessionState";
import migrateUserData from "./migrateUserData";

/**
 * Migrates extension data from previous versions to the current one.
 *
 * @param context
 * @param storage Storage object used to determinate if migration is necessary.
 */
export async function migrateExtensionDataFromPreviousVersions(
    context: vscode.ExtensionContext,
    storage: Storage,
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
        const migratedExtensionSettings = await migrateExtensionSettings(memento, settings);
        const migratedSessionState = migrateSessionState(memento);
        const migratedUserData = migrateUserData(memento);

        // Workspace data migration - this one is a bit more tricky so do it last.
        const migratedExerciseData = await migrateExerciseData(memento, dialog, tmc);

        await storage.updateExtensionSettings(migratedExtensionSettings.data);
        await storage.updateSessionState(migratedSessionState.data);
        await storage.updateUserData(migratedUserData.data);

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

function getActiveOldWorkspaceName(memento: vscode.Memento): string | undefined {
    interface ExtensionSettingsPartial {
        dataPath: string;
    }

    const workspaceFile = vscode.workspace.workspaceFile;
    const dataPath = memento.get<ExtensionSettingsPartial>("extensionSettings")?.dataPath;

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
