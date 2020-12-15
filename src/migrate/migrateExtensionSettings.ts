import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { MigratedData } from "./types";

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings";
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";

function validateData<T>(
    data: unknown,
    validator: (object: unknown) => object is T,
): T | undefined {
    if (!data) {
        return undefined;
    }

    if (!validator(data)) {
        throw Error("Data type missmatch: " + JSON.stringify(data));
    }

    return data;
}

export enum LogLevelV0 {
    None = "none",
    Errors = "errors",
    Verbose = "verbose",
    Debug = "debug",
}

export enum LogLevelV1 {
    None = "none",
    Errors = "errors",
    Verbose = "verbose",
}

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
    logLevel: LogLevelV1;
    updateExercisesAutomatically: boolean;
}

const logLevelV0toV1 = (logLevel: LogLevelV0): LogLevelV1 => {
    switch (logLevel) {
        case LogLevelV0.Debug:
        case LogLevelV0.Verbose:
            return LogLevelV1.Verbose;
        case LogLevelV0.Errors:
            return LogLevelV1.Errors;
        case LogLevelV0.None:
            return LogLevelV1.None;
    }
};

const extensionDataFromV0toV1 = (unstableData: ExtensionSettingsV0): ExtensionSettingsV1 => ({
    dataPath: unstableData.dataPath,
    downloadOldSubmission: unstableData.downloadOldSubmission ?? true,
    hideMetaFiles: unstableData.hideMetaFiles ?? true,
    insiderVersion: unstableData.insiderVersion ?? false,
    logLevel: unstableData.logLevel ? logLevelV0toV1(unstableData.logLevel) : LogLevelV1.Errors,
    updateExercisesAutomatically: unstableData.updateExercisesAutomatically ?? true,
});

export function migrateExtensionSettings(
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
