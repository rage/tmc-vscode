import * as v1 from "./data_v1";

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
