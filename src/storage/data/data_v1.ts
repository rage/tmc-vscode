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
