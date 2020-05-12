import Storage from "./storage";
import { ExtensionSettings, ExtensionSettingsData } from "./types";
import { Err, Ok, Result } from "ts-results";
import Logger from "../utils/logger";

/**
 * Settings class to manage user settings in storage.
 */
export default class Settings {
    private readonly storage: Storage;
    private readonly logger: Logger;
    private settings: ExtensionSettings;

    constructor(storage: Storage, logger: Logger, settings: ExtensionSettings) {
        this.storage = storage;
        this.logger = logger;
        this.settings = settings;
        this.updateExtensionSettings(settings);
    }

    /**
     * Gets the extension settings from storage.
     *
     * @returns ExtensionSettings object or error
     */
    public async getExtensionSettings(): Promise<Result<ExtensionSettings, Error>> {
        const settings = this.storage.getExtensionSettings();
        if (!settings) {
            const msg = "Could not find settings from storage.";
            return new Err(new Error(msg));
        }
        return new Ok(settings);
    }

    /**
     * Update extension settings to storage.
     * @param settings ExtensionSettings object
     */
    public async updateExtensionSettings(settings: ExtensionSettings): Promise<void> {
        this.storage.updateExtensionSettings(settings);
    }

    /**
     * Updates individual setting for user.
     * @param data ExtensionSettingsData object, for example { setting: 'dataPath', value: '~/newpath' }
     */
    public updateSetting(data: ExtensionSettingsData): void {
        switch (data.setting) {
            case "dataPath":
                this.settings.dataPath = data.value;
                break;
            case "logLevel":
                this.settings.logLevel = data.value;
                break;
            case "hideMetaFiles":
                this.settings.hideMetaFiles = data.value;
                break;
        }
        this.logger.log("Updated settings data", data);
        this.updateExtensionSettings(this.settings);
    }
}
