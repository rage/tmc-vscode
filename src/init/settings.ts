import Storage from "../config/storage";
import Resources from "../config/resources";
import Logger, { LogLevel } from "../utils/logger";
import { ExtensionSettings } from "../config/types";
import { is } from "typescript-is";

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

    const tmcDataPath = settings?.dataPath || resources.getDataPath();
    const logLevel =
        is<LogLevel>(settings?.logLevel) && settings?.logLevel
            ? settings?.logLevel
            : LogLevel.Errors;
    const hideMetaFiles = settings?.hideMetaFiles || true;

    const fixedSettings: ExtensionSettings = {
        dataPath: tmcDataPath,
        logLevel,
        hideMetaFiles,
    };
    logger.log("Settings initialized", fixedSettings);

    return fixedSettings;
}
