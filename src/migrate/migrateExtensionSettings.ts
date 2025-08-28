import { semVerCompare } from "../utilities";
import { MigratedData } from "./types";
import validateData from "./validateData";
import { createIs } from "typia";
import * as vscode from "vscode";

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings";
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";
const UNSTABLE_EXTENSION_VERSION_KEY = "extensionVersion";
const SESSION_STATE_KEY_V1 = "session-state-v1";

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
    downloadOldSubmission: boolean;
    hideMetaFiles: boolean;
    insiderVersion: boolean;
    logLevel: "none" | "errors" | "verbose";
    updateExercisesAutomatically: boolean;
}

interface SessionStatePartial {
    extensionVersion: string | undefined;
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

async function extensionDataFromV0toV1(
    unstableData: ExtensionSettingsV0,
): Promise<ExtensionSettingsV1> {
    const logLevel = unstableData.logLevel ? logLevelV0toV1(unstableData.logLevel) : "errors";

    return {
        downloadOldSubmission: unstableData.downloadOldSubmission ?? true,
        hideMetaFiles: unstableData.hideMetaFiles ?? true,
        insiderVersion: unstableData.insiderVersion ?? false,
        logLevel,
        updateExercisesAutomatically: unstableData.updateExercisesAutomatically ?? true,
    };
}

async function migrateSettingsToVSCodeSettingsAPI(
    memento: vscode.Memento,
    storageSettings: ExtensionSettingsV1,
    settings: vscode.WorkspaceConfiguration,
): Promise<void> {
    let version = memento.get<string>(UNSTABLE_EXTENSION_VERSION_KEY);
    if (!version) {
        version = memento.get<SessionStatePartial>(SESSION_STATE_KEY_V1)?.extensionVersion;
    }
    const compareVersions = semVerCompare(version ?? "0.0.0", "2.1.0", "minor");
    if (!compareVersions || compareVersions < 0) {
        await settings.update(
            "testMyCode.downloadOldSubmission",
            storageSettings.downloadOldSubmission,
            true,
        );
        await settings.update("testMyCode.hideMetaFiles", storageSettings.hideMetaFiles, true);
        await settings.update(
            "testMyCode.updateExercisesAutomatically",
            storageSettings.updateExercisesAutomatically,
            true,
        );
        await settings.update("testMyCode.insiderVersion", storageSettings.insiderVersion, true);
        await settings.update("testMyCode.logLevel", storageSettings.logLevel, true);
    }
}

export default async function migrateExtensionSettings(
    memento: vscode.Memento,
    settings: vscode.WorkspaceConfiguration,
): Promise<MigratedData<ExtensionSettingsV1>> {
    const obsoleteKeys: string[] = [];
    const dataV0 = validateData(
        memento.get(EXTENSION_SETTINGS_KEY_V0),
        createIs<ExtensionSettingsV0>(),
    );
    if (dataV0) {
        obsoleteKeys.push(EXTENSION_SETTINGS_KEY_V0);
    }

    const dataV1 = dataV0
        ? await extensionDataFromV0toV1(dataV0)
        : validateData(memento.get(EXTENSION_SETTINGS_KEY_V1), createIs<ExtensionSettingsV1>());

    if (dataV1) {
        await migrateSettingsToVSCodeSettingsAPI(memento, dataV1, settings);
    }

    return { data: dataV1, obsoleteKeys };
}
