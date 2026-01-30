import * as v1 from "./data_v1";

// global storage keys
export import USER_DATA_KEY = v1.USER_DATA_KEY;
export import EXTENSION_SETTINGS_KEY = v1.EXTENSION_SETTINGS_KEY;
export import SESSION_STATE_KEY = v1.SESSION_STATE_KEY;

// extension settings keys
export const TMC_DOWNLOAD_OLD_SUBMISSION_KEY = "testMyCode.downloadOldSubmission";
export const TMC_HIDE_META_FILES_KEY = "testMyCode.hideMetaFiles";
export const TMC_UPDATE_EXERCISES_AUTOMATICALLY_KEY = "testMyCode.updateExercisesAutomatically";
export const TMC_INSIDER_VERSION_KEY = "testMyCode.insiderVersion";
export const TMC_LOG_LEVEL_KEY = "testMyCode.logLevel";

// langs settings
export function langsClosedExercisesKey(exerciseId: string): string {
    return `closed-exercises-for:${exerciseId}`;
}

// data types
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
    exercises: Array<LocalCourseExercise>;
    availablePoints: number;
    awardedPoints: number;
    perhapsExamMode: boolean;
    newExercises: Array<number>;
    notifyAfter: number;
    disabled: boolean;
    materialUrl: string | null;
}

export interface UserData {
    courses: Array<LocalCourseData>;
}
