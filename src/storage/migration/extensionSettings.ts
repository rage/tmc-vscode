import { createIs } from "typia";
import * as vscode from "vscode";

import { semVerCompare } from "../../utilities";

import * as data from "../data";
import validateData, { MigratedData } from ".";

function v1_logLevelFromV0(logLevel: data.v0.LogLevel): data.v1.LogLevel {
    switch (logLevel) {
        case data.v0.LogLevel.Debug:
        case data.v0.LogLevel.Verbose:
            return "verbose";
        case data.v0.LogLevel.Errors:
            return "errors";
        case data.v0.LogLevel.None:
            return "none";
    }
}

export async function v1_migrateFromV0(
    unstableData: data.v0.ExtensionSettings,
): Promise<data.v1.ExtensionSettings> {
    const logLevel = unstableData.logLevel ? v1_logLevelFromV0(unstableData.logLevel) : "errors";

    return {
        downloadOldSubmission: unstableData.downloadOldSubmission ?? true,
        hideMetaFiles: unstableData.hideMetaFiles ?? true,
        insiderVersion: unstableData.insiderVersion ?? false,
        logLevel,
        updateExercisesAutomatically: unstableData.updateExercisesAutomatically ?? true,
    };
}

interface V1SessionStatePartial {
    extensionVersion: string | undefined;
}

// extension settings are no longer managed manually
export async function vscodeapi_migrateFromV1(
    memento: vscode.Memento,
    storageSettings: data.v1.ExtensionSettings,
    settings: vscode.WorkspaceConfiguration,
): Promise<void> {
    let version = memento.get<string>(data.v0.EXTENSION_VERSION_KEY);
    if (!version) {
        version = memento.get<V1SessionStatePartial>(data.v1.SESSION_STATE_KEY)?.extensionVersion;
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

export default async function migrateExtensionSettingsToLatest(
    memento: vscode.Memento,
    settings: vscode.WorkspaceConfiguration,
): Promise<MigratedData<data.v1.ExtensionSettings>> {
    const obsoleteKeys: string[] = [];
    const dataV0 = validateData(
        memento.get(data.v0.EXTENSION_SETTINGS_KEY),
        createIs<data.v0.ExtensionSettings>(),
    );
    if (dataV0) {
        obsoleteKeys.push(data.v0.EXTENSION_SETTINGS_KEY);
    }

    const dataV1 = dataV0
        ? await v1_migrateFromV0(dataV0)
        : validateData(
              memento.get(data.v1.EXTENSION_SETTINGS_KEY),
              createIs<data.v1.ExtensionSettings>(),
          );

    if (dataV1) {
        await vscodeapi_migrateFromV1(memento, dataV1, settings);
    }

    return { data: dataV1, obsoleteKeys };
}
