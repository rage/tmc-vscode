import Storage, { ExtensionSettings } from "../api/storage";
import { removeOldData } from "../utils";
import { Logger } from "../utils/logger";
import { showNotification } from "../window";

/**
 * @deprecated Only tries to remove old datapath at the moment. Consider relocating.
 */
export async function settingsInitialization(storage: Storage): Promise<void> {
    const settings: Partial<ExtensionSettings> | undefined = storage.getExtensionSettings();
    const oldState = storage.getSessionState();
    Logger.log("Initializing settings", settings);

    // Try removing once old data, if the data move happened within 10 minutes.
    if (oldState?.oldDataPath !== undefined) {
        const result = await removeOldData(oldState.oldDataPath);
        if (result.err) {
            showNotification(
                "Some files could not be removed from the previous workspace directory." +
                    `They will have to be removed manually. ${oldState.oldDataPath}`,
                ["OK", (): void => {}],
            );
        }
        Logger.log("Tried to remove old data", result);
    }
}
