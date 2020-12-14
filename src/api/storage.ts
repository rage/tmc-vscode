import * as vscode from "vscode";

import {
    ExtensionSettingsV0,
    ExtensionSettingsV1,
    LocalExerciseDataV0,
    LocalExerciseDataV1,
} from "./storageSchema";

interface Options<T> {
    version: T;
}

export interface LocalCourseData {
    id: number;
    name: string;
    title: string;
    description: string;
    organization: string;
    exercises: LocalCourseExercise[];
    availablePoints: number;
    awardedPoints: number;
    perhapsExamMode: boolean;
    newExercises: number[];
    notifyAfter: number;
    disabled: boolean;
    materialUrl: string | null;
}

export interface LocalCourseExercise {
    id: number;
    name: string;
    deadline: string | null;
    passed: boolean;
    softDeadline: string | null;
}

export interface UserData {
    courses: LocalCourseData[];
}

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
    private static readonly _exerciseDataVersion = 1;
    private static readonly _settingsVersion = 1;
    private static readonly _extensionVersionVersion = 1;
    private static readonly _userDataKey = "user-data-v1";

    private _context: vscode.ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    getExerciseData(options: Options<0>): LocalExerciseDataV0[] | undefined;
    getExerciseData(options: Options<1>): LocalExerciseDataV1[] | undefined;
    getExerciseData(): LocalExerciseDataV1[] | undefined;

    public getExerciseData(options?: Options<number>): unknown {
        const version = options?.version ?? Storage._exerciseDataVersion;
        const key = this._exerciseDataVersionToKey(version);
        switch (version) {
            case 0:
                return this._context.globalState.get<LocalExerciseDataV0[]>(key);
            case 1:
                return this._context.globalState.get<LocalExerciseDataV1[]>(key);
            default:
                throw `Unsupported data version ${version}`;
        }
    }

    public getUserData(): UserData | undefined {
        return this._context.globalState.get<UserData>(Storage._userDataKey);
    }

    getExtensionSettings(options: Options<0>): ExtensionSettingsV0 | undefined;
    getExtensionSettings(options: Options<1>): ExtensionSettingsV1 | undefined;
    getExtensionSettings(): ExtensionSettingsV1 | undefined;

    public getExtensionSettings(options?: Options<number>): unknown {
        const version = options?.version ?? Storage._settingsVersion;
        const key = this._settingsVersionToKey(version);
        switch (version) {
            case 0:
                return this._context.globalState.get<ExtensionSettingsV0>(key);
            case 1:
                return this._context.globalState.get<ExtensionSettingsV1>(key);
        }
        return this._context.globalState.get("extensionSettings");
    }

    public getExtensionVersion(options?: Options<number>): string | undefined {
        const version = options?.version ?? Storage._extensionVersionVersion;
        const key = this._extensionVersionVersionToKey(version);
        return this._context.globalState.get<string>(key);
    }

    public async updateExerciseData(
        exerciseData: LocalExerciseDataV1[] | undefined,
    ): Promise<void> {
        const key = this._exerciseDataVersionToKey(Storage._exerciseDataVersion);
        await this._context.globalState.update(key, exerciseData);
    }

    public async updateUserData(userData: UserData | undefined): Promise<void> {
        await this._context.globalState.update(Storage._userDataKey, userData);
    }

    public async updateExtensionSettings(settings: ExtensionSettingsV1): Promise<void> {
        const key = this._settingsVersionToKey(Storage._settingsVersion);
        await this._context.globalState.update(key, settings);
    }

    public async updateExtensionVersion(version: string): Promise<void> {
        await this._context.globalState.update("extensionVersion", version);
    }

    public async wipeStorage(): Promise<void> {
        await this._context.globalState.update("token", undefined);
        await this._context.globalState.update("exerciseData", undefined);
        await this._context.globalState.update("exercise-data-v1", undefined);
        await this._context.globalState.update("userData", undefined);
        await this._context.globalState.update("user-data-v1", undefined);
        await this._context.globalState.update("extensionSettings", undefined);
        await this._context.globalState.update("extension-settings-v1", undefined);
        await this._context.globalState.update("extensionVersion", undefined);
        await this._context.globalState.update("extension-version-v1", undefined);
    }

    private _exerciseDataVersionToKey(version: number): string {
        return version <= 0 ? "exerciseData" : `exercise-data-v${version}`;
    }

    private _settingsVersionToKey(version: number): string {
        return version <= 0 ? "extensionSettings" : `extension-settings-v${version}`;
    }

    private _extensionVersionVersionToKey(version: number): string {
        return version <= 0 ? "extensionVersion" : `extension-version-v${version}`;
    }
}
