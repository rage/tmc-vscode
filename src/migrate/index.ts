import { concat } from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import Storage from "../api/storage";
import TMC from "../api/tmc";

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
    tmc: TMC,
): Promise<Result<void, Error>> {
    const memento = context.globalState;

    try {
        const oldWorkspaceOpen = isOldWorkspaceOpen(context.globalState);

        const migratedExtensionSettings = await migrateExtensionSettings(memento);
        const migratedSessionState = migrateSessionState(memento);
        const migratedUserData = migrateUserData(memento);

        // Workspace data migration - this one is a bit more tricky so do it last.
        const migratedExerciseData = await migrateExerciseData(memento, tmc);

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

        if (oldWorkspaceOpen) {
            await vscode.commands.executeCommand("workbench.action.closeFolder");
            // Migration is complete but prevent extension from proceeding
            throw new Error("Version migration complete but restart required.");
        }
    } catch (e) {
        return Err(e);
    }

    return Ok.EMPTY;
}

function isOldWorkspaceOpen(memento: vscode.Memento): boolean {
    interface ExtensionSettingsPartial {
        dataPath: string;
    }

    const workspaceFile = vscode.workspace.workspaceFile;
    const dataPath = memento.get<ExtensionSettingsPartial>("extensionSettings")?.dataPath;

    if (!workspaceFile || !dataPath) {
        return false;
    }

    // Logger.debug("workspacefile " + workspaceFile.fsPath);
    // Logger.debug("datapath " + vscode.Uri.file(dataPath).fsPath);
    // Logger.debug(path.relative(workspaceFile.fsPath, vscode.Uri.file(dataPath).fsPath));
    return (
        path.relative(workspaceFile.fsPath, vscode.Uri.file(dataPath).fsPath) ===
        path.join("..", "..")
    );
}
