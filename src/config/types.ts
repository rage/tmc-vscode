import { LogLevel } from "../utils/";

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
