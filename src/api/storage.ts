import * as vscode from "vscode";

import { LogLevel } from "../utils";

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

export enum ExerciseStatus {
    OPEN = "open",
    CLOSED = "closed",
    MISSING = "missing",
}

export interface LocalExerciseData {
    id: number;
    name: string;
    course: string;
    path: string;
    status: ExerciseStatus;
}

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
    private static readonly _extensionVersionVersion = 1;
    private static readonly _extensionSettingsKey = "extension-settings-v1";
    private static readonly _userDataKey = "user-data-v1";
    private static readonly _exerciseDataKey = "exercise-data-v1";

    private _context: vscode.ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    public getExerciseData(): LocalExerciseData[] | undefined {
        return this._context.globalState.get<LocalExerciseData[]>(Storage._exerciseDataKey);
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

    public async updateExerciseData(exerciseData: LocalExerciseData[] | undefined): Promise<void> {
        await this._context.globalState.update(Storage._exerciseDataKey, exerciseData);
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

    private _extensionVersionVersionToKey(version: number): string {
        return version <= 0 ? "extensionVersion" : `extension-version-v${version}`;
    }
}
