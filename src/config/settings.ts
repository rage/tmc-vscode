import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import Storage from "../api/storage";
import { ExtensionSettingsV1 } from "../api/storageSchema";
import { isCorrectWorkspaceOpen } from "../utils";
import { Logger, LogLevel } from "../utils/logger";

import { HIDE_META_FILES, SHOW_META_FILES, WATCHER_EXCLUDE } from "./constants";
import Resources from "./resources";
import { ExtensionSettingsData } from "./types";

export type ExtensionSettings = ExtensionSettingsV1;

/**
 * Settings class communicates changes to persistent storage and manages TMC
 * Workspace.code-workspace settings. Workspace settings will only be updated when it is open.
 *
 * Perhaps TODO: Read and Write the .code-workspace file without using vscode premade functions for
 * workspace, because they require the workspace to be open. Currently this approach works, because
 * extension settings are saved to storage and VSCode restarts when our workspace is opened by the
 * extension.
 */
export default class Settings {
    private readonly _storage: Storage;

    private readonly _resources: Resources;

    private _settings: ExtensionSettings;

    constructor(storage: Storage, settings: ExtensionSettings, resources: Resources) {
        this._storage = storage;
        this._resources = resources;
        this._settings = settings;
    }

    public async verifyWorkspaceSettingsIntegrity(): Promise<void> {
        const workspace = vscode.workspace.name;
        if (workspace && isCorrectWorkspaceOpen(this._resources, workspace.split(" ")[0])) {
            Logger.log("TMC Workspace open, verifying workspace settings integrity.");
            await this._setFilesExcludeInWorkspace(this._settings.hideMetaFiles);
            await this._verifyWatcherPatternExclusion();
        }
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
        switch (data.setting) {
            case "dataPath":
                this._settings.dataPath = data.value;
                break;
            case "downloadOldSubmission":
                this._settings.downloadOldSubmission = data.value;
                break;
            case "hideMetaFiles":
                this._settings.hideMetaFiles = data.value;
                this._setFilesExcludeInWorkspace(data.value);
                break;
            case "insiderVersion":
                this._settings.insiderVersion = data.value;
                break;
            case "logLevel":
                this._settings.logLevel = data.value;
                break;
            case "oldDataPath":
                this._settings.oldDataPath = { path: data.value, timestamp: Date.now() };
                break;
            case "updateExercisesAutomatically":
                this._settings.updateExercisesAutomatically = data.value;
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
        const settings = this._storage.getExtensionSettings();
        if (!settings) {
            const msg = "Could not find settings from storage.";
            return new Err(new Error(msg));
        }
        return new Ok(settings);
    }

    /**
     * Returns the section for the Workspace setting. If undefined, returns all settings.
     * @param section A dot-separated identifier.
     */
    public getWorkspaceSettings(section?: string): vscode.WorkspaceConfiguration | undefined {
        const workspace = vscode.workspace.name?.split(" ")[0];
        if (workspace && isCorrectWorkspaceOpen(this._resources, workspace)) {
            return vscode.workspace.getConfiguration(
                section,
                vscode.Uri.file(this._resources.getWorkspaceFilePath(workspace)),
            );
        }
    }

    public isInsider(): boolean {
        return this._settings.insiderVersion;
    }

    /**
     * Updates files.exclude values in TMC Workspace.code-workspace.
     * Keeps all user/workspace defined excluding patterns.
     * @param hide true to hide meta files in TMC workspace.
     */
    private async _setFilesExcludeInWorkspace(hide: boolean): Promise<void> {
        const value = hide ? HIDE_META_FILES : SHOW_META_FILES;
        await this._updateWorkspaceSetting("files.exclude", value);
    }

    /**
     * Updates a section for the TMC Workspace.code-workspace file, if the workspace is open.
     * @param section Configuration name, supports dotted names.
     * @param value The new value
     */
    private async _updateWorkspaceSetting(section: string, value: unknown): Promise<void> {
        const workspace = vscode.workspace.name?.split(" ")[0];
        if (workspace && isCorrectWorkspaceOpen(this._resources, workspace)) {
            const oldValue = this.getWorkspaceSettings(section);
            let newValue = value;
            if (value instanceof Object) {
                newValue = { ...oldValue, ...value };
            }
            await vscode.workspace
                .getConfiguration(
                    undefined,
                    vscode.Uri.file(this._resources.getWorkspaceFilePath(workspace)),
                )
                .update(section, newValue, vscode.ConfigurationTarget.Workspace);
        }
    }

    /**
     * Makes sure that folders and its contents aren't deleted by our watcher.
     * .vscode folder needs to be unwatched, otherwise adding settings to WorkspaceFolder level
     * doesn't work. For example defining Python interpreter for the Exercise folder.
     */
    private async _verifyWatcherPatternExclusion(): Promise<void> {
        await this._updateWorkspaceSetting("files.watcherExclude", { ...WATCHER_EXCLUDE });
    }
}
