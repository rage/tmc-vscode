import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { MigratedData } from "./types";
import validateData from "./validateData";

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings";
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";

export enum LogLevelV0 {
    None = "none",
    Errors = "errors",
    Verbose = "verbose",
    Debug = "debug",
}

export type LogLevelV1 = "none" | "errors" | "verbose";

export interface ExtensionSettingsV0 {
    dataPath: string;
    downloadOldSubmission?: boolean;
    hideMetaFiles?: boolean;
    insiderVersion?: boolean;
    logLevel?: LogLevelV0;
    oldDataPath?: { path: string; timestamp: number } | undefined;
    updateExercisesAutomatically?: boolean;
}

export interface ExtensionSettingsV1 {
    dataPath: string;
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: "none" | "errors" | "verbose";
    updateExercisesAutomatically: boolean;
}

function logLevelV0toV1(logLevel: LogLevelV0): LogLevelV1 {
    switch (logLevel) {
        case LogLevelV0.Debug:
        case LogLevelV0.Verbose:
            return "verbose";
        case LogLevelV0.Errors:
            return "errors";
        case LogLevelV0.None:
            return "none";
    }
}

function extensionDataFromV0toV1(unstableData: ExtensionSettingsV0): ExtensionSettingsV1 {
    const logLevel = unstableData.logLevel ? logLevelV0toV1(unstableData.logLevel) : "errors";

    return {
        dataPath: unstableData.dataPath,
        downloadOldSubmission: unstableData.downloadOldSubmission ?? true,
        hideMetaFiles: unstableData.hideMetaFiles ?? true,
        insiderVersion: unstableData.insiderVersion ?? false,
        logLevel,
        updateExercisesAutomatically: unstableData.updateExercisesAutomatically ?? true,
    };
}

export default function migrateExtensionSettings(
    memento: vscode.Memento,
): MigratedData<ExtensionSettingsV1> {
    const keys: string[] = [EXTENSION_SETTINGS_KEY_V0];
    const dataV0 = validateData(
        memento.get(EXTENSION_SETTINGS_KEY_V0),
        createIs<ExtensionSettingsV0>(),
    );

    keys.push(EXTENSION_SETTINGS_KEY_V1);
    const dataV1 = dataV0
        ? extensionDataFromV0toV1(dataV0)
        : validateData(memento.get(EXTENSION_SETTINGS_KEY_V1), createIs<ExtensionSettingsV1>());

    return { data: dataV1, keys };
}
