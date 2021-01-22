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

    try {
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
    } catch (e) {
        return Err(e);
    }

    return Ok.EMPTY;
}
