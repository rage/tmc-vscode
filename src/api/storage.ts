import * as vscode from "vscode";

import { LogLevel } from "../utils";

import { LocalExerciseDataV0, LocalExerciseDataV1 } from "./storageSchema";

interface Options<T> {
    version: T;
}

export interface ExtensionSettings {
    dataPath: string;
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: LogLevel;
    oldDataPath: { path: string; timestamp: number } | undefined;
    updateExercisesAutomatically: boolean;
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
    private static readonly _extensionVersionVersion = 1;
    private static readonly _extensionSettingsKey = "extension-settings-v1";
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

    public getExtensionSettings(): ExtensionSettings | undefined {
        return this._context.globalState.get<ExtensionSettings>(Storage._extensionSettingsKey);
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

    public async updateExtensionSettings(settings: ExtensionSettings): Promise<void> {
        return this._context.globalState.update(Storage._extensionSettingsKey, settings);
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

    private _extensionVersionVersionToKey(version: number): string {
        return version <= 0 ? "extensionVersion" : `extension-version-v${version}`;
    }
}
