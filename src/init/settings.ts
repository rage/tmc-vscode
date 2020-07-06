import { is } from "typescript-is";

import Resources from "../config/resources";
import Storage from "../config/storage";
import { ExtensionSettings } from "../config/types";
import { removeOldData } from "../utils";
import Logger, { LogLevel } from "../utils/logger";

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
    logger: Logger,
): Promise<ExtensionSettings> {
    const settings = storage.getExtensionSettings();
    logger.log("Initializing settings", settings);

    // Try removing once old data, if the data move happened within 10 minutes.
    if (settings && settings.oldDataPath !== undefined) {
        const result = await removeOldData(settings.oldDataPath);
        logger.log("Tried to remove old data", result);
    }
    const tmcDataPath = settings?.dataPath || resources.getDataPath();
    const logLevel =
        is<LogLevel>(settings?.logLevel) && settings?.logLevel
            ? settings.logLevel
            : LogLevel.Errors;
    const hideMetaFiles = settings?.hideMetaFiles !== undefined ? settings.hideMetaFiles : true;

    const fixedSettings: ExtensionSettings = {
        dataPath: tmcDataPath,
        oldDataPath: undefined,
        logLevel,
        hideMetaFiles,
    };
    logger.log("Settings initialized", fixedSettings);

    return fixedSettings;
}
