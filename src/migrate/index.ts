import { concat } from "lodash";
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

    // Workspace data migration
    try {
        const migratedExerciseData = await migrateExerciseData(memento, tmc);
        for (const key of migratedExerciseData.obsoleteKeys) {
            await memento.update(key, undefined);
        }
    } catch (e) {
        return Err(e);
    }

    // Versioned data migration
    const extensionSettings = storage.getExtensionSettings();
    const sessionState = storage.getSessionState();
    const userData = storage.getUserData();

    const needToMigrate = !extensionSettings || !sessionState || !userData;
    if (!needToMigrate) {
        return Ok.EMPTY;
    }

    try {
        const migratedExtensionSettings = await migrateExtensionSettings(memento, tmc);
        const migratedSessionState = migrateSessionState(memento);
        const migratedUserData = migrateUserData(memento);

        await storage.updateExtensionSettings(migratedExtensionSettings.data);
        await storage.updateSessionState(migratedSessionState.data);
        await storage.updateUserData(migratedUserData.data);

        const keysToRemove = concat(
            migratedExtensionSettings.obsoleteKeys,
            migratedSessionState.obsoleteKeys,
            migratedUserData.obsoleteKeys,
        );
        for (const key of keysToRemove) {
            await memento.update(key, undefined);
        }
    } catch (e) {
        return Err(e);
    }

    return Ok.EMPTY;
}
