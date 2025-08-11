import * as vscode from "vscode";

import { LocalMoocCourseData, LocalTmcCourseData } from "../shared/shared";

export interface ExtensionSettings {
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: "none" | "errors" | "verbose";
    updateExercisesAutomatically: boolean;
}

export interface UserData {
    tmcCourses: LocalTmcCourseData[];
    moocCourses: LocalMoocCourseData[];
}

export interface SessionState {
    extensionVersion?: string | undefined;
}

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
    private static readonly _extensionSettingsKey = "extension-settings-v1";
    private static readonly _userDataKey = "user-data-v2";
    private static readonly _sessionStateKey = "session-state-v1";

    private _context: vscode.ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    public getUserData(): UserData | undefined {
        return this._context.globalState.get<UserData>(Storage._userDataKey);
    }

    /**
     * @deprecated Extension Settings will be stored in VSCode, remove on major 3.0 release.
     */
    public getExtensionSettings(): ExtensionSettings | undefined {
        return this._context.globalState.get<ExtensionSettings>(Storage._extensionSettingsKey);
    }

    public getSessionState(): SessionState | undefined {
        return this._context.globalState.get<SessionState>(Storage._sessionStateKey);
    }

    public async updateUserData(userData: UserData | undefined): Promise<void> {
        await this._context.globalState.update(Storage._userDataKey, userData);
    }

    public async updateExtensionSettings(settings: ExtensionSettings | undefined): Promise<void> {
        await this._context.globalState.update(Storage._extensionSettingsKey, settings);
    }

    public async updateSessionState(sessionState: SessionState | undefined): Promise<void> {
        await this._context.globalState.update(Storage._sessionStateKey, sessionState);
    }

    public async wipeStorage(): Promise<void> {
        await this.updateExtensionSettings(undefined);
        await this.updateSessionState(undefined);
        await this.updateUserData(undefined);
    }
}
