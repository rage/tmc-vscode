import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { isCorrectWorkspaceOpen } from "../utils";
import { Logger, LogLevel } from "../utils/logger";

import { HIDE_META_FILES, SHOW_META_FILES, WATCHER_EXCLUDE } from "./constants";
import Resources from "./resources";
import Storage from "./storage";
import { ExtensionSettings, ExtensionSettingsData } from "./types";

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
    private readonly storage: Storage;
    private readonly resources: Resources;
    private settings: ExtensionSettings;

    constructor(storage: Storage, settings: ExtensionSettings, resources: Resources) {
        this.storage = storage;
        this.resources = resources;
        this.settings = settings;
        this.verifyWorkspaceSettingsIntegrity();
    }

    private verifyWorkspaceSettingsIntegrity(): void {
        const workspace = vscode.workspace.name;
        if (workspace && isCorrectWorkspaceOpen(this.resources, workspace.split(" ")[0])) {
            Logger.log("TMC Workspace open, verifying workspace settings integrity.");
            this.setFilesExcludeInWorkspace(this.settings.hideMetaFiles);
            this.verifyWatcherPatternExclusion();
        }
    }

    /**
     * Makes sure that folders and its contents aren't deleted by our watcher.
     * .vscode folder needs to be unwatched, otherwise adding settings to WorkspaceFolder level
     * doesn't work. For example defining Python interpreter for the Exercise folder.
     */
    private async verifyWatcherPatternExclusion(): Promise<void> {
        await this.updateWorkspaceSetting("files.watcherExclude", { ...WATCHER_EXCLUDE });
    }

    /**
     * Update extension settings to storage.
     * @param settings ExtensionSettings object
     */
    public async updateExtensionSettingsToStorage(settings: ExtensionSettings): Promise<void> {
        await this.storage.updateExtensionSettings(settings);
    }

    /**
     * Updates individual setting for user and adds them to user storage.
     *
     * @param {ExtensionSettingsData} data ExtensionSettingsData object, for example { setting:
     * 'dataPath', value: '~/newpath' }
     */
    public async updateSetting(data: ExtensionSettingsData): Promise<void> {
        switch (data.setting) {
            case "insiderVersion":
                this.settings.insiderVersion = data.value;
                break;
            case "dataPath":
                this.settings.dataPath = data.value;
                break;
            case "oldDataPath":
                this.settings.oldDataPath = { path: data.value, timestamp: Date.now() };
                break;
            case "logLevel":
                this.settings.logLevel = data.value;
                break;
            case "hideMetaFiles":
                this.settings.hideMetaFiles = data.value;
                this.setFilesExcludeInWorkspace(data.value);
                break;
        }
        Logger.log("Updated settings data", data);
        await this.updateExtensionSettingsToStorage(this.settings);
    }

    public getLogLevel(): LogLevel {
        return this.settings.logLevel;
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
     * Updates files.exclude values in TMC Workspace.code-workspace.
     * Keeps all user/workspace defined excluding patterns.
     * @param hide true to hide meta files in TMC workspace.
     */
    private async setFilesExcludeInWorkspace(hide: boolean): Promise<void> {
        const value = hide ? HIDE_META_FILES : SHOW_META_FILES;
        await this.updateWorkspaceSetting("files.exclude", value);
    }

    /**
     * Updates a section for the TMC Workspace.code-workspace file, if the workspace is open.
     * @param section Configuration name, supports dotted names.
     * @param value The new value
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async updateWorkspaceSetting(section: string, value: any): Promise<void> {
        const workspace = vscode.workspace.name;
        if (workspace && isCorrectWorkspaceOpen(this.resources, workspace.split(" ")[0])) {
            const oldValue = this.getWorkspaceSettings(section);
            let newValue = value;
            if (value instanceof Object) {
                newValue = { ...oldValue, ...value };
            }
            await vscode.workspace
                .getConfiguration(
                    undefined,
                    vscode.Uri.file(this.resources.getWorkspaceFilePath(workspace.split(" ")[0])),
                )
                .update(section, newValue, vscode.ConfigurationTarget.Workspace);
        }
    }

    /**
     * Returns the section for the Workspace setting. If undefined, returns all settings.
     * @param section A dot-separated identifier.
     */
    public getWorkspaceSettings(section?: string): vscode.WorkspaceConfiguration | undefined {
        const workspace = vscode.workspace.name;
        if (workspace && isCorrectWorkspaceOpen(this.resources, workspace.split(" ")[0])) {
            return vscode.workspace.getConfiguration(
                section,
                vscode.Uri.file(this.resources.getWorkspaceFilePath(workspace.split(" ")[0])),
            );
        }
    }

    public isInsider(): boolean {
        return this.settings.insiderVersion;
    }
}
