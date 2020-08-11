import { is } from "typescript-is";

import Resources from "../config/resources";
import Storage from "../config/storage";
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
    const settings = storage.getExtensionSettings();
    Logger.log("Initializing settings", settings);

    // Try removing once old data, if the data move happened within 10 minutes.
    if (settings && settings.oldDataPath !== undefined) {
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
    const insiderVersion = settings?.insiderVersion !== undefined ? settings.insiderVersion : false;
    const tmcDataPath = settings?.dataPath || resources.getDataPath();
    const logLevel = insiderVersion
        ? LogLevel.Verbose
        : is<LogLevel>(settings?.logLevel) && settings?.logLevel
        ? settings.logLevel
        : LogLevel.Errors;
    const hideMetaFiles = settings?.hideMetaFiles !== undefined ? settings.hideMetaFiles : true;

    const fixedSettings: ExtensionSettings = {
        insiderVersion: insiderVersion,
        dataPath: tmcDataPath,
        oldDataPath: undefined,
        logLevel,
        hideMetaFiles,
    };
    await storage.updateExtensionSettings(fixedSettings);
    Logger.log("Settings initialized", fixedSettings);

    return fixedSettings;
}
