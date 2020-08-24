import * as oauth2 from "client-oauth2";
import * as vscode from "vscode";

import { ExtensionSettings, LocalCourseData, LocalExerciseData } from "./types";

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
    private _context: vscode.ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    /**
     * Gets currently stored authentication token.
     *
     * @deprecated Since version 1.0.0. Authentication token is now completely handled by TMC-langs.
     *
     * @returns currently stored authentication token or undefined if not set
     */
    public getAuthenticationToken(): oauth2.Data | undefined {
        return this._context.globalState.get("token");
    }

    public getExerciseData(): LocalExerciseData[] | undefined {
        return this._context.globalState.get("exerciseData");
    }

    public getUserData(): { courses: LocalCourseData[] } | undefined {
        return this._context.globalState.get("userData");
    }

    public getExtensionSettings(): ExtensionSettings | undefined {
        return this._context.globalState.get("extensionSettings");
    }

    public getExtensionVersion(): string | undefined {
        return this._context.globalState.get("extensionVersion");
    }

    /**
     * Updates the given authentication token in storage.
     *
     * @deprecated Since version 1.0.0. Can only be used to clear old data.
     *
     * @param authenticationToken authentication token to update
     */
    public async updateAuthenticationToken(authenticationToken: undefined): Promise<void> {
        await this._context.globalState.update("token", authenticationToken);
    }

    public async updateExerciseData(exerciseData: LocalExerciseData[] | undefined): Promise<void> {
        await this._context.globalState.update("exerciseData", exerciseData);
    }

    public async updateUserData(userData: { courses: LocalCourseData[] }): Promise<void> {
        await this._context.globalState.update("userData", userData);
    }

    public async updateExtensionSettings(settings: ExtensionSettings): Promise<void> {
        await this._context.globalState.update("extensionSettings", settings);
    }

    public async updateExtensionVersion(version: string): Promise<void> {
        await this._context.globalState.update("extensionVersion", version);
    }

    public async wipeStorage(): Promise<void> {
        await this._context.globalState.update("token", undefined);
        await this._context.globalState.update("exerciseData", undefined);
        await this._context.globalState.update("userData", undefined);
        await this._context.globalState.update("extensionSettings", undefined);
        await this._context.globalState.update("extensionVersion", undefined);
    }
}
