import * as vscode from "vscode";

export interface ExtensionSettings {
    dataPath: string;
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: "none" | "errors" | "verbose";
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

export interface SessionState {
    extensionVersion?: string | undefined;
    oldDataPath?: { path: string; timestamp: number } | undefined;
}

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
    private static readonly _extensionSettingsKey = "extension-settings-v1";
    private static readonly _userDataKey = "user-data-v1";
    private static readonly _exerciseDataKey = "exercise-data-v1";
    private static readonly _sessionStateKey = "session-state-v1";

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

    public getSessionState(): SessionState | undefined {
        return this._context.globalState.get<SessionState>(Storage._sessionStateKey);
    }

    public async updateExerciseData(exerciseData: LocalExerciseData[] | undefined): Promise<void> {
        await this._context.globalState.update(Storage._exerciseDataKey, exerciseData);
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
        await this.updateExerciseData(undefined);
        await this.updateExtensionSettings(undefined);
        await this.updateSessionState(undefined);
        await this.updateUserData(undefined);
    }
}
