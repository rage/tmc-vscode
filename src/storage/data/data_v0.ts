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
