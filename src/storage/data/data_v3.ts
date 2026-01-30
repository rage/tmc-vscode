import * as v2 from "./data_v2";

// global storage keys
export const USER_DATA_KEY = "user-data-v3";
export const EXTENSION_SETTINGS_KEY = "extension-settings-v3";
export import SESSION_STATE_KEY = v2.SESSION_STATE_KEY;

export import LogLevel = v2.LogLevel;
export import SessionState = v2.SessionState;
export import ExerciseStatus = v2.ExerciseStatus;
export import TmcLocalCourseExercise = v2.LocalCourseExercise;
export import TmcLocalCourseData = v2.LocalCourseData;

// data types
export interface MoocLocalCourseExercise {
    id: string;
    availablePoints: number;
    awardedPoints: number;
    /// Equivalent to exercise slug
    name: string;
    deadline: string | null;
    passed: boolean;
    softDeadline: string | null;
}

export interface MoocLocalCourseData {
    // instance id
    id: string;
    courseId: string;
    // course slug
    name: string;
    instanceName: string | null;
    title: string;
    description: string | null;
    courseDescription: string | null;
    organization: string;
    exercises: Array<MoocLocalCourseExercise>;
    availablePoints: number;
    awardedPoints: number;
    perhapsExamMode: boolean;
    newExercises: Array<string>;
    notifyAfter: number;
    disabled: boolean;
    materialUrl: string | null;
}

export interface UserData {
    // tmc_courses
    courses: Array<TmcLocalCourseData>;
    mooc_courses: Array<MoocLocalCourseData>;
}

export interface ExtensionSettings {
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: LogLevel;
    updateExercisesAutomatically: boolean;
    javaHome: string;
}
