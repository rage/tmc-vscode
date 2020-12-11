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
    // eslint-disable-next-line @typescript-eslint/naming-convention
    material_url: string | null;
};

export type LocalCourseExercise = {
    id: number;
    name: string;
    deadline: string | null;
    passed: boolean;
    softDeadline: string | null;
};

export type ExtensionSettings = {
    dataPath: string;
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: LogLevel;
    oldDataPath: { path: string; timestamp: number } | undefined;
    updateExercisesAutomatically: boolean;
};

export type ExtensionSettingsData =
    | { setting: "dataPath"; value: string }
    | { setting: "downloadOldSubmission"; value: boolean }
    | { setting: "hideMetaFiles"; value: boolean }
    | { setting: "insiderVersion"; value: boolean }
    | { setting: "logLevel"; value: LogLevel }
    | { setting: "oldDataPath"; value: string }
    | { setting: "updateExercisesAutomatically"; value: boolean };
