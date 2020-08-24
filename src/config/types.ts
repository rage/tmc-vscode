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
    perhapsExamMode: boolean;
    newExercises: number[];
    notifyAfter: number;
    disabled: boolean;
    material_url: string | null;
};

export type LocalCourseExercise = {
    id: number;
    name: string;
    passed: boolean;
};

export type LocalExerciseData = {
    id: number;
    name: string;
    course: string;
    organization: string;
    checksum: string;
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
    insiderVersion: boolean;
    dataPath: string;
    logLevel: LogLevel;
    hideMetaFiles: boolean;
    oldDataPath: { path: string; timestamp: number } | undefined;
    downloadOldSubmission: boolean;
};

export type ExtensionSettingsData =
    | { setting: "insiderVersion"; value: boolean }
    | { setting: "dataPath"; value: string }
    | { setting: "oldDataPath"; value: string }
    | { setting: "logLevel"; value: LogLevel }
    | { setting: "hideMetaFiles"; value: boolean }
    | { setting: "downloadOldSubmission"; value: boolean };
