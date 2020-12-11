import { is } from "typescript-is";

import Storage from "../api/storage";
import Resources from "../config/resources";
import { ExtensionSettings } from "../config/types";
import { removeOldData } from "../utils";
import { Logger, LogLevel } from "../utils/logger";
import { showNotification } from "../window";

// TODO: Perhaps not initialize if everything is ok.
/**
 * Initializes settings.
 * Gets settings from storage and goes through all values, sets as default if not found.
 *
 * @returns ExtensionSettings object with all the necessary fields.
 */
export async function settingsInitialization(
    storage: Storage,
    resources: Resources,
): Promise<ExtensionSettings> {
    const settings: Partial<ExtensionSettings> | undefined = storage.getExtensionSettings();
    Logger.log("Initializing settings", settings);

    // Try removing once old data, if the data move happened within 10 minutes.
    if (settings?.oldDataPath !== undefined) {
        const result = await removeOldData(settings.oldDataPath);
        if (result.err) {
            showNotification(
                "Some files could not be removed from the previous workspace directory." +
                    `They will have to be removed manually. ${settings.oldDataPath}`,
                ["OK", (): void => {}],
            );
        }
        Logger.log("Tried to remove old data", result);
    }

    const insiderVersion = settings?.insiderVersion ?? false;
    const logLevel = insiderVersion
        ? LogLevel.Verbose
        : is<LogLevel>(settings?.logLevel) && settings?.logLevel
        ? settings.logLevel
        : LogLevel.Errors;

    const fixedSettings: ExtensionSettings = {
        dataPath: settings?.dataPath ?? resources.projectsDirectory,
        downloadOldSubmission: settings?.downloadOldSubmission ?? true,
        hideMetaFiles: settings?.hideMetaFiles ?? true,
        insiderVersion,
        logLevel,
        oldDataPath: undefined,
        updateExercisesAutomatically: settings?.updateExercisesAutomatically ?? true,
    };

    await storage.updateExtensionSettings(fixedSettings);
    Logger.log("Settings initialized", fixedSettings);

    return fixedSettings;
}
