import {
    ExtensionSettingsV0,
    ExtensionSettingsV1,
    LogLevelV0,
} from "../../migrate/migrateExtensionSettings";

const v0_3_0 = (root: string): ExtensionSettingsV0 => {
    return { dataPath: root };
};

const v0_5_0 = (root: string): ExtensionSettingsV0 => {
    return {
        dataPath: root,
        logLevel: LogLevelV0.Verbose,
        hideMetaFiles: true,
    };
};

const v0_9_0 = (root: string): ExtensionSettingsV0 => {
    return {
        dataPath: root,
        hideMetaFiles: true,
        insiderVersion: true,
        logLevel: LogLevelV0.Verbose,
        oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
    };
};

const v1_0_0 = (root: string): ExtensionSettingsV0 => {
    return {
        dataPath: root,
        downloadOldSubmission: false,
        hideMetaFiles: true,
        insiderVersion: true,
        logLevel: LogLevelV0.Verbose,
        oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
    };
};

const v1_2_0 = (root: string): ExtensionSettingsV0 => {
    return {
        dataPath: root,
        downloadOldSubmission: false,
        hideMetaFiles: true,
        insiderVersion: true,
        logLevel: LogLevelV0.Verbose,
        oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
        updateExercisesAutomatically: false,
    };
};

const v2_0_0: ExtensionSettingsV1 = {
    downloadOldSubmission: false,
    hideMetaFiles: true,
    insiderVersion: true,
    logLevel: "verbose",
    updateExercisesAutomatically: false,
};

export { v0_3_0, v0_5_0, v0_9_0, v1_0_0, v1_2_0, v2_0_0 };
