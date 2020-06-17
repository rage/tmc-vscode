import { LogLevel } from "../utils/";

export type LocalCourseData = {
    id: number;
    name: string;
    title: string;
    description: string;
    organization: string;
    exercises: LocalCourseExercise[];
    availablePoints: number;
    awardedPoints: number;
    newExercises: number[];
    notifyAfter: number;
};

export type LocalCourseExercise = {
    id: number;
    passed: boolean;
};

export type LocalExerciseData = {
    id: number;
    name: string;
    course: string;
    organization: string;
    checksum: string;
    updateAvailable: boolean;
    status: ExerciseStatus;
    deadline: string | null;
    softDeadline: string | null;
};

export enum ExerciseStatus {
    OPEN,
    CLOSED,
    MISSING,
}

export type ExtensionSettings = {
    dataPath: string;
    logLevel: LogLevel;
    hideMetaFiles: boolean;
};

export type ExtensionSettingsData =
    | { setting: "dataPath"; value: string }
    | { setting: "logLevel"; value: LogLevel }
    | { setting: "hideMetaFiles"; value: boolean };
