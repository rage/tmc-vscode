import Storage, { SessionState } from "../api/storage";
import { Logger, LogLevel } from "../utilities/logger";
import * as vscode from "vscode";

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
    private _onChangeHideMetaFiles?: (value: boolean) => void;
    private _onChangeDownloadOldSubmission?: (value: boolean) => void;
    private _onChangeUpdateExercisesAutomatically?: (value: boolean) => void;

    /**
     * @deprecated Storage dependency should be removed when major 3.0 release.
     */
    private readonly _storage: Storage;

    private _state: SessionState;
    private _disposables: vscode.Disposable[];

    constructor(storage: Storage) {
        this._storage = storage;
        this._state = storage.getSessionState() ?? {};
        this._disposables = [
            vscode.workspace.onDidChangeConfiguration(async (event) => {
                if (event.affectsConfiguration("testMyCode.logLevel")) {
                    const value = vscode.workspace
                        .getConfiguration("testMyCode")
                        .get<LogLevel>("logLevel", LogLevel.Errors);
                    Logger.configure(value);
                }

                // Workspace settings
                if (event.affectsConfiguration("testMyCode.hideMetaFiles")) {
                    const value = this._getWorkspaceSettingValue("hideMetaFiles");
                    this._onChangeHideMetaFiles?.(value);
                }
                if (event.affectsConfiguration("testMyCode.downloadOldSubmission")) {
                    const value = this._getWorkspaceSettingValue("downloadOldSubmission");
                    this._onChangeDownloadOldSubmission?.(value);
                }
                if (event.affectsConfiguration("testMyCode.updateExercisesAutomatically")) {
                    const value = this._getWorkspaceSettingValue("updateExercisesAutomatically");
                    this._onChangeUpdateExercisesAutomatically?.(value);
                }
                await this.updateExtensionSettingsToStorage();
            }),
        ];
    }

    public set onChangeDownloadOldSubmission(callback: (value: boolean) => void) {
        this._onChangeDownloadOldSubmission = callback;
    }

    public set onChangeHideMetaFiles(callback: (value: boolean) => void) {
        this._onChangeHideMetaFiles = callback;
    }

    public set onChangeUpdateExercisesAutomatically(callback: (value: boolean) => void) {
        this._onChangeUpdateExercisesAutomatically = callback;
    }

    public dispose(): void {
        this._disposables.forEach((x) => x.dispose());
    }

    /**
     * @deprecated Storage dependency should be removed when major 3.0 release.
     */
    public async updateExtensionSettingsToStorage(): Promise<void> {
        const settings: ExtensionSettings = {
            downloadOldSubmission: this._getUserSettingValue("downloadOldSubmission"),
            hideMetaFiles: this._getUserSettingValue("hideMetaFiles"),
            updateExercisesAutomatically: this._getUserSettingValue("updateExercisesAutomatically"),
            logLevel:
                vscode.workspace.getConfiguration().get("testMyCode.logLevel") ?? LogLevel.Errors,
            insiderVersion: this._getUserSettingValue("insiderVersion"),
        };
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
        await vscode.workspace.getConfiguration("testMyCode").update("insiderVersion", value, true);
        await this.updateExtensionSettingsToStorage();
    }

    /**
     * Used to fetch boolean values from VSCode settings API Workspace scope
     *
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

    /**
     * Used to fetch boolean values from VSCode settings API User Scope
     */
    private _getUserSettingValue(section: string): boolean {
        const configuration = vscode.workspace.getConfiguration("testMyCode");
        const scopeSettings = configuration.inspect<boolean>(section);
        if (scopeSettings?.globalValue === undefined) {
            return !!scopeSettings?.defaultValue;
        } else {
            return scopeSettings.globalValue;
        }
    }
}
