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
    const exerciseData = storage.getExerciseData();
    const extensionSettings = storage.getExtensionSettings();
    const sessionState = storage.getSessionState();
    const userData = storage.getUserData();

    const needToMigrate = !exerciseData || !extensionSettings || !sessionState || !userData;
    if (!needToMigrate) {
        return Ok.EMPTY;
    }

    try {
        const memento = context.globalState;
        const migratedExerciseData = await migrateExerciseData(memento, tmc);
        const migratedExtensionSettings = await migrateExtensionSettings(memento, tmc);
        const migratedSessionState = migrateSessionState(memento);
        const migratedUserData = migrateUserData(memento);

        if (migratedExerciseData.err) {
            throw migratedExerciseData.val;
        }

        // await storage.updateExerciseData(migratedExerciseData.data);
        await storage.updateExtensionSettings(migratedExtensionSettings.data);
        await storage.updateSessionState(migratedSessionState.data);
        await storage.updateUserData(migratedUserData.data);

        // eslint-disable-next-line max-len
        // const keysToClear = _.concat(migratedExerciseData.data, migratedExtensionSettings.keys, migratedSessionState.keys, migratedSessionState.keys);
        // for (const key of keysToClear) {
        //     await memento.update(key, undefined);
        // }
    } catch (e) {
        return Err(e);
    }

    return Ok.EMPTY;
}
