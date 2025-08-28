// All types that are stored in VSCode's storage should be defined here
// to ensure they're versioned correctly.

export namespace v0 {
    export const EXERCISE_DATA_KEY = "exerciseData";
    export const USER_DATA_KEY = "userData";
    export const EXTENSION_SETTINGS_KEY = "extensionSettings";
    export const EXTENSION_VERSION_KEY = "extensionVersion";

    export interface LocalCourseDataExercise {
        id: number;
        passed: boolean;
        name?: string;
        deadline?: string | null;
        softDeadline?: string | null;
    }

    export interface LocalCourseData {
        id: number;
        name: string;
        description: string;
        organization: string;
        availablePoints?: number;
        awardedPoints?: number;
        disabled?: boolean;
        exercises: Array<LocalCourseDataExercise>;
        newExercises?: number[];
        perhapsExamMode?: boolean;
        title?: string;
        notifyAfter?: number;
        material_url?: string | null;
    }

    export enum ExerciseStatus {
        OPEN = 0,
        CLOSED = 1,
        MISSING = 2,
    }

    export interface LocalExerciseData {
        id: number;
        checksum: string;
        name: string;
        course: string;
        deadline?: string | null;
        isOpen?: boolean;
        organization: string;
        path?: string;
        softDeadline?: string | null;
        status?: ExerciseStatus;
        updateAvailable?: boolean;
    }

    export enum LogLevel {
        None = "none",
        Errors = "errors",
        Verbose = "verbose",
        Debug = "debug",
    }

    export interface ExtensionSettings {
        dataPath: string;
        downloadOldSubmission?: boolean;
        hideMetaFiles?: boolean;
        insiderVersion?: boolean;
        logLevel?: LogLevel;
        oldDataPath?: { path: string; timestamp: number } | undefined;
        updateExercisesAutomatically?: boolean;
    }
}

export namespace v1 {
    export const USER_DATA_KEY = "user-data-v1";
    export const EXTENSION_SETTINGS_KEY = "extension-settings-v1";
    export const SESSION_STATE_KEY = "session-state-v1";

    export interface LocalCourseDataExercise {
        id: number;
        awardedPoints?: number;
        availablePoints?: number;
        name: string;
        deadline: string | null;
        passed: boolean;
        softDeadline: string | null;
    }

    export interface LocalCourseData {
        id: number;
        name: string;
        title: string;
        description: string;
        organization: string;
        exercises: Array<LocalCourseDataExercise>;
        availablePoints: number;
        awardedPoints: number;
        perhapsExamMode: boolean;
        newExercises: number[];
        notifyAfter: number;
        disabled: boolean;
        materialUrl: string | null;
    }

    export enum ExerciseStatus {
        OPEN = "open",
        CLOSED = "closed",
        MISSING = "missing",
    }

    export interface ExtensionSettings {
        downloadOldSubmission: boolean;
        hideMetaFiles: boolean;
        insiderVersion: boolean;
        logLevel: "none" | "errors" | "verbose";
        updateExercisesAutomatically: boolean;
    }

    export type LogLevel = "none" | "errors" | "verbose";

    export interface SessionState {
        extensionVersion?: string | undefined;
    }
}

export namespace v2 {
    export import USER_DATA_KEY = v1.USER_DATA_KEY;
    export import EXTENSION_SETTINGS_KEY = v1.EXTENSION_SETTINGS_KEY;
    export import SESSION_STATE_KEY = v1.SESSION_STATE_KEY;

    export import LogLevel = v1.LogLevel;
    export import SessionState = v1.SessionState;
    export import ExtensionSettings = v1.ExtensionSettings;
    export import ExerciseStatus = v1.ExerciseStatus;

    export interface LocalCourseExercise {
        id: number;
        availablePoints: number;
        awardedPoints: number;
        /// Equivalent to exercise slug
        name: string;
        deadline: string | null;
        passed: boolean;
        softDeadline: string | null;
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

    export interface UserData {
        courses: LocalCourseData[];
    }
}
