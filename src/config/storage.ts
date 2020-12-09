import * as vscode from "vscode";

import {
    ExtensionSettings,
    LocalCourseData,
    LocalExerciseData,
    LocalExerciseDataV1,
    LocalExerciseDataV2,
} from "./types";

interface Options<T> {
    version: T;
}

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
    private readonly _exerciseDataVersion = 2;

    private _context: vscode.ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    getExerciseData(options?: Options<number>): LocalExerciseData[] | undefined;
    getExerciseData(options: Options<1>): LocalExerciseDataV1[] | undefined;
    getExerciseData(options: Options<2>): LocalExerciseDataV2[] | undefined;

    public getExerciseData(options?: Options<number>): unknown {
        const version = options?.version ?? this._exerciseDataVersion;
        const key = this._exerciseDataVersionToKey(version);
        switch (version) {
            case 1:
                return this._context.globalState.get<LocalExerciseDataV1[]>(key);
            case 2:
                return this._context.globalState.get<LocalExerciseDataV2[]>(key);
            default:
                throw `Unsupported data version ${version}`;
        }
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

    public async updateExerciseData(exerciseData: LocalExerciseData[] | undefined): Promise<void> {
        const key = this._exerciseDataVersionToKey(this._exerciseDataVersion);
        await this._context.globalState.update(key, exerciseData);
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
        await this._context.globalState.update("exercise-data-v2", undefined);
        await this._context.globalState.update("exerciseData", undefined);
        await this._context.globalState.update("userData", undefined);
        await this._context.globalState.update("extensionSettings", undefined);
        await this._context.globalState.update("extensionVersion", undefined);
    }

    private _exerciseDataVersionToKey(version: number): string {
        return version === 1 ? "exerciseData" : `exercise-data-v${version}`;
    }
}
