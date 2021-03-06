import { LogLevel } from "../utils/";

export type ExtensionSettingsData =
    | { setting: "downloadOldSubmission"; value: boolean }
    | { setting: "hideMetaFiles"; value: boolean }
    | { setting: "insiderVersion"; value: boolean }
    | { setting: "logLevel"; value: LogLevel }
    | { setting: "updateExercisesAutomatically"; value: boolean };
