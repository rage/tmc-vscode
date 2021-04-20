import * as path from "path";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import Storage, {
    ExtensionSettings as SerializedExtensionSettings,
    SessionState,
} from "../api/storage";
import { Logger, LogLevel } from "../utils/logger";

import Resources from "./resources";
import { ExtensionSettingsData } from "./types";

export interface ExtensionSettings {
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: LogLevel;
    updateExercisesAutomatically: boolean;
}

/**
 * TODO: Deprecate class
 */
export default class Settings {
    private static readonly _defaultSettings: ExtensionSettings = {
        downloadOldSubmission: true,
        hideMetaFiles: true,
        insiderVersion: false,
        logLevel: LogLevel.Errors,
        updateExercisesAutomatically: true,
    };

    private readonly _storage: Storage;

    private readonly _resources: Resources;

    private _settings: ExtensionSettings;
    private _state: SessionState;

    constructor(storage: Storage, resources: Resources) {
        this._storage = storage;
        this._resources = resources;
        const storedSettings = storage.getExtensionSettings();
        this._settings = storedSettings
            ? Settings._deserializeExtensionSettings(storedSettings)
            : Settings._defaultSettings;
        this._state = storage.getSessionState() ?? {};
    }

    /**
     * Update extension settings to storage.
     * @param settings ExtensionSettings object
     */
    public async updateExtensionSettingsToStorage(settings: ExtensionSettings): Promise<void> {
        await this._storage.updateExtensionSettings(settings);
    }

    /**
     * Updates individual setting for user and adds them to user storage.
     *
     * @param {ExtensionSettingsData} data ExtensionSettingsData object, for example { setting:
     * 'dataPath', value: '~/newpath' }
     */
    public async updateSetting(data: ExtensionSettingsData): Promise<void> {
        // This is to ensure that settings globalStorage and the vscode settings match for now...
        const workspaceFile = vscode.workspace.workspaceFile;
        let isOurWorkspace: string | undefined = undefined;
        if (
            workspaceFile &&
            path.relative(workspaceFile.fsPath, this._resources.workspaceFileFolder) === ".."
        ) {
            isOurWorkspace = vscode.workspace.name?.split(" ")[0];
        }

        switch (data.setting) {
            case "downloadOldSubmission":
                this._settings.downloadOldSubmission = data.value;
                if (isOurWorkspace) {
                    await vscode.workspace
                        .getConfiguration(
                            "testMyCode",
                            vscode.Uri.file(this._resources.getWorkspaceFilePath(isOurWorkspace)),
                        )
                        .update("downloadOldSubmission", data.value);
                }
                break;
            case "hideMetaFiles":
                this._settings.hideMetaFiles = data.value;
                if (isOurWorkspace) {
                    await vscode.workspace
                        .getConfiguration(
                            "testMyCode",
                            vscode.Uri.file(this._resources.getWorkspaceFilePath(isOurWorkspace)),
                        )
                        .update("hideMetaFiles", data.value);
                }
                break;
            case "insiderVersion":
                this._settings.insiderVersion = data.value;
                await vscode.workspace
                    .getConfiguration("testMyCode")
                    .update("insiderVersion", data.value);
                break;
            case "logLevel":
                this._settings.logLevel = data.value;
                await vscode.workspace
                    .getConfiguration("testMyCode")
                    .update("logLevel", data.value);
                break;
            case "updateExercisesAutomatically":
                this._settings.updateExercisesAutomatically = data.value;
                if (isOurWorkspace) {
                    await vscode.workspace
                        .getConfiguration(
                            "testMyCode",
                            vscode.Uri.file(this._resources.getWorkspaceFilePath(isOurWorkspace)),
                        )
                        .update("updateExercisesAutomatically", data.value);
                }
                break;
        }
        Logger.log("Updated settings data", data);
        await this.updateExtensionSettingsToStorage(this._settings);
    }

    public getLogLevel(): LogLevel {
        return this._settings.logLevel;
    }

    public getDownloadOldSubmission(): boolean {
        return this._settings.downloadOldSubmission;
    }

    public getAutomaticallyUpdateExercises(): boolean {
        return this._settings.updateExercisesAutomatically;
    }

    /**
     * Gets the extension settings from storage.
     *
     * @returns ExtensionSettings object or error
     */
    public async getExtensionSettings(): Promise<Result<ExtensionSettings, Error>> {
        return Ok(this._settings);
    }

    public isInsider(): boolean {
        return this._settings.insiderVersion;
    }

    private static _deserializeExtensionSettings(
        settings: SerializedExtensionSettings,
    ): ExtensionSettings {
        let logLevel: LogLevel = LogLevel.Errors;
        switch (settings.logLevel) {
            case "errors":
                logLevel = LogLevel.Errors;
                break;
            case "none":
                logLevel = LogLevel.None;
                break;
            case "verbose":
                logLevel = LogLevel.Verbose;
                break;
        }

        return {
            ...settings,
            logLevel,
        };
    }
}
