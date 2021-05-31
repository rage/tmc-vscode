import * as vscode from "vscode";

import Storage, {
    ExtensionSettings as SerializedExtensionSettings,
    SessionState,
} from "../api/storage";
import { Logger, LogLevel } from "../utils/logger";

/**
 * @deprecated Default values are now implemented in package.json / VSCode settings.
 */
export interface ExtensionSettings {
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: LogLevel;
    updateExercisesAutomatically: boolean;
}

/**
 * Class to manage VSCode setting changes and trigger events based on changes.
 * Remove Storage dependency once 3.0 major release is being done, as then
 * we do not need to be backwards compatible.
 *
 * Handle multi-root workspace changes by creating callbacks in extension.ts,
 * so that we can test and don't need workspaceManager dependency.
 */
export default class Settings implements vscode.Disposable {
    /**
     * @deprecated Default values are now implemented in package.json / VSCode settings.
     */
    private static readonly _defaultSettings: ExtensionSettings = {
        downloadOldSubmission: true,
        hideMetaFiles: true,
        insiderVersion: false,
        logLevel: LogLevel.Errors,
        updateExercisesAutomatically: true,
    };

    private _onChangeHideMetaFiles?: (value: boolean) => void;
    private _onChangeDownloadOldSubmission?: (value: boolean) => void;
    private _onChangeUpdateExercisesAutomatically?: (value: boolean) => void;
    private _onChangeTmcDataPath?: () => void;

    /**
     * @deprecated Storage dependency should be removed when major 3.0 release.
     */
    private readonly _storage: Storage;

    /**
     * @deprecated Values will be stored in VSCode Settings
     */
    private _settings: ExtensionSettings;
    private _state: SessionState;
    private _disposables: vscode.Disposable[];

    constructor(storage: Storage) {
        this._storage = storage;
        // Remove on major 3.0
        const storedSettings = storage.getExtensionSettings();
        // Remove on major 3.0
        this._settings = storedSettings
            ? Settings._deserializeExtensionSettings(storedSettings)
            : Settings._defaultSettings;
        this._state = storage.getSessionState() ?? {};
        this._disposables = [
            vscode.workspace.onDidChangeConfiguration(async (event) => {
                if (event.affectsConfiguration("testMyCode.logLevel")) {
                    const value = vscode.workspace
                        .getConfiguration("testMyCode")
                        .get<LogLevel>("logLevel", LogLevel.Errors);
                    Logger.configure(value);
                    this._settings.logLevel = value;
                }
                if (event.affectsConfiguration("testMyCode.insiderVersion")) {
                    const value = vscode.workspace
                        .getConfiguration("testMyCode")
                        .get<boolean>("insiderVersion", false);
                    this._settings.insiderVersion = value;
                }
                // Hacky work-around, because VSCode Settings UI
                // doesn't support buttons to toggle an event
                if (event.affectsConfiguration("testMyCode.dataPath.changeTmcDataPath")) {
                    const value = vscode.workspace
                        .getConfiguration("testMyCode")
                        .get<boolean>("dataPath.changeTmcDataPath", false);
                    if (value) {
                        this._onChangeTmcDataPath?.();
                        await vscode.workspace
                            .getConfiguration()
                            .update("testMyCode.dataPath.changeTmcDataPath", false, true);
                    }
                }

                // Workspace settings
                if (event.affectsConfiguration("testMyCode.hideMetaFiles")) {
                    const value = this._getWorkspaceSettingValue("hideMetaFiles");
                    this._onChangeHideMetaFiles?.(value);
                    this._settings.hideMetaFiles = value;
                }
                if (event.affectsConfiguration("testMyCode.downloadOldSubmission")) {
                    const value = this._getWorkspaceSettingValue("downloadOldSubmission");
                    this._onChangeDownloadOldSubmission?.(value);
                    this._settings.downloadOldSubmission = value;
                }
                if (event.affectsConfiguration("testMyCode.updateExercisesAutomatically")) {
                    const value = this._getWorkspaceSettingValue("updateExercisesAutomatically");
                    this._onChangeUpdateExercisesAutomatically?.(value);
                    this._settings.updateExercisesAutomatically = value;
                }
                await this.updateExtensionSettingsToStorage(this._settings);
            }),
        ];
    }

    public set onChangeDownloadOldSubmission(callback: (value: boolean) => void) {
        this._onChangeDownloadOldSubmission = callback;
    }

    public set onChangeHideMetaFiles(callback: (value: boolean) => void) {
        this._onChangeHideMetaFiles = callback;
    }

    public set onChangeTmcDataPath(callback: () => void) {
        this._onChangeTmcDataPath = callback;
    }

    public set onChangeUpdateExercisesAutomatically(callback: (value: boolean) => void) {
        this._onChangeUpdateExercisesAutomatically = callback;
    }

    public dispose(): void {
        this._disposables.forEach((x) => x.dispose());
    }

    public async setTmcDataPathPlaceholder(path: string): Promise<void> {
        await vscode.workspace
            .getConfiguration("testMyCode.dataPath")
            .update("currentLocation", path, true);
    }

    /**
     * @deprecated Storage dependency should be removed when major 3.0 release.
     */
    public async updateExtensionSettingsToStorage(settings: ExtensionSettings): Promise<void> {
        await this._storage.updateExtensionSettings(settings);
    }

    public getLogLevel(): LogLevel {
        return vscode.workspace
            .getConfiguration("testMyCode")
            .get<LogLevel>("logLevel", LogLevel.Errors);
    }

    public getDownloadOldSubmission(): boolean {
        return this._getWorkspaceSettingValue("downloadOldSubmission");
    }

    public getAutomaticallyUpdateExercises(): boolean {
        return this._getWorkspaceSettingValue("updateExercisesAutomatically");
    }

    public isInsider(): boolean {
        return vscode.workspace
            .getConfiguration("testMyCode")
            .get<boolean>("insiderVersion", false);
    }

    public async configureIsInsider(value: boolean): Promise<void> {
        this._settings.insiderVersion = value;
        await vscode.workspace.getConfiguration("testMyCode").update("insiderVersion", value, true);
        await this.updateExtensionSettingsToStorage(this._settings);
    }

    /**
     * @deprecated To be removed aswell when Storage dependency removed in major 3.0.
     */
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

    /**
     * workspaceValue is undefined in multi-root workspace if it matches defaultValue
     * We want to "force" the value in the multi-root workspace, because then
     * the workspace scope > user scope.
     */
    private _getWorkspaceSettingValue(section: string): boolean {
        const configuration = vscode.workspace.getConfiguration("testMyCode");
        const scopeSettings = configuration.inspect<boolean>(section);
        if (scopeSettings?.workspaceValue === undefined) {
            return !!scopeSettings?.defaultValue;
        } else {
            return scopeSettings.workspaceValue;
        }
    }
}
