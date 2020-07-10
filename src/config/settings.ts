import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { isWorkspaceOpen } from "../utils";
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
    private readonly logger: Logger;
    private readonly resources: Resources;
    private settings: ExtensionSettings;

    constructor(
        storage: Storage,
        logger: Logger,
        settings: ExtensionSettings,
        resources: Resources,
    ) {
        this.storage = storage;
        this.logger = logger;
        this.resources = resources;
        this.settings = settings;
        this.updateExtensionSettingsToStorage(settings);
        this.verifyWorkspaceSettingsIntegrity();
    }

    private verifyWorkspaceSettingsIntegrity(): void {
        if (isWorkspaceOpen(this.resources)) {
            Logger.log("TMC Workspace open, verifying workspace settings integrity.");
            this.setFilesExcludeInWorkspace(this.settings.hideMetaFiles);
            this.verifyFoldersInWorkspace();
            this.verifyWatcherPatternExclusion();
            this.updateWorkspaceSetting("python.terminal.executeInFileDir", true);
        }
    }

    /**
     * Checks that the necessary root folders are open in the workspace and opens them if they
     * aren't. Doesn't remove user added folders from workspace.
     */
    private verifyFoldersInWorkspace(): void {
        if (isWorkspaceOpen(this.resources)) {
            vscode.workspace.updateWorkspaceFolders(
                vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0,
                null,
                { uri: vscode.Uri.file(this.resources.getExercisesFolderPath()) },
            );
        }
    }

    /**
     * Makes sure that folders and its contents aren't deleted by our watcher.
     * .vscode folder needs to be unwatched, otherwise adding settings to WorkspaceFolder level
     * doesn't work. For example defining Python interpreter for the Exercise folder.
     */
    private verifyWatcherPatternExclusion(): void {
        this.updateWorkspaceSetting("files.watcherExclude", { ...WATCHER_EXCLUDE });
    }

    /**
     * Update extension settings to storage.
     * @param settings ExtensionSettings object
     */
    public async updateExtensionSettingsToStorage(settings: ExtensionSettings): Promise<void> {
        this.storage.updateExtensionSettings(settings);
    }

    /**
     * Updates individual setting for user and adds them to user storage.
     *
     * @param {ExtensionSettingsData} data ExtensionSettingsData object, for example { setting:
     * 'dataPath', value: '~/newpath' }
     */
    public updateSetting(data: ExtensionSettingsData): void {
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
        this.updateExtensionSettingsToStorage(this.settings);
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
    private setFilesExcludeInWorkspace(hide: boolean): void {
        const value = hide ? HIDE_META_FILES : SHOW_META_FILES;
        this.updateWorkspaceSetting("files.exclude", value);
    }

    /**
     * Updates a section for the TMC Workspace.code-workspace file, if the workspace is open.
     * @param section Configuration name, supports dotted names.
     * @param value The new value
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private updateWorkspaceSetting(section: string, value: any): void {
        if (isWorkspaceOpen(this.resources)) {
            const oldValue = this.getWorkspaceSettings(section);
            let newValue = value;
            if (value instanceof Object) {
                newValue = { ...oldValue, ...value };
            }
            vscode.workspace
                .getConfiguration(undefined, vscode.Uri.file(this.resources.getWorkspaceFilePath()))
                .update(section, newValue, vscode.ConfigurationTarget.Workspace);
        }
    }

    /**
     * Returns the section for the Workspace setting. If undefined, returns all settings.
     * @param section A dot-separated identifier.
     */
    public getWorkspaceSettings(section?: string): vscode.WorkspaceConfiguration | undefined {
        if (isWorkspaceOpen(this.resources)) {
            return vscode.workspace.getConfiguration(
                section,
                vscode.Uri.file(this.resources.getWorkspaceFilePath()),
            );
        }
    }

    public isInsider(): boolean {
        return this.settings.insiderVersion;
    }
}
