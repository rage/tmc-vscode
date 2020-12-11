import { LogLevel } from "../utils";

// Volatile enum usage
enum ExerciseStatusV0 {
    OPEN,
    CLOSED,
    MISSING,
}

// Unstable
export interface LocalExerciseDataV0 {
    id: number;
    name: string;
    course: string;
    organization: string;
    checksum: string;
    status: ExerciseStatusV0;
}

export enum ExerciseStatus {
    OPEN = "open",
    CLOSED = "closed",
    MISSING = "missing",
}

export interface LocalExerciseDataV1 {
    id: number;
    name: string;
    course: string;
    path: string;
    status: ExerciseStatus;
}

// Unstable
export interface LocalCourseExerciseV0 {
    id: number;
    passed: boolean;
    name?: string;
    deadline?: string | null;
    softDeadline?: string | null;
}

export interface LocalCourseExerciseV1 {
    id: number;
    name: string;
    deadline: string | null;
    passed: boolean;
    softDeadline: string | null;
}

// Unstable
export interface LocalCourseDataV0 {
    id: number;
    name: string;
    description: string;
    organization: string;
    title?: string;
    exercises?: LocalCourseExerciseV0[];
    availablePoints?: number;
    awardedPoints?: number;
    perhapsExamMode?: boolean;
    newExercises?: number[];
    notifyAfter?: number;
    disabled?: boolean;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    material_url?: string | null;
}

export interface LocalCourseDataV1 {
    id: number;
    name: string;
    title: string;
    description: string;
    organization: string;
    exercises: LocalCourseExerciseV1[];
    availablePoints: number;
    awardedPoints: number;
    perhapsExamMode: boolean;
    newExercises: number[];
    notifyAfter: number;
    disabled: boolean;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    material_url: string | null;
}

export interface ExtensionSettingsV0 {
    dataPath: string;
    downloadOldSubmission?: boolean;
    hideMetaFiles?: boolean;
    insiderVersion?: boolean;
    logLevel?: LogLevel;
    oldDataPath?: { path: string; timestamp: number } | undefined;
    updateExercisesAutomatically?: boolean;
}

export interface ExtensionSettingsV1 {
    dataPath: string;
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: LogLevel;
    oldDataPath: { path: string; timestamp: number } | undefined;
    updateExercisesAutomatically: boolean;
}
