import {
    ExtensionSettingsV0,
    ExtensionSettingsV1,
    LogLevelV0,
} from "../../migrate/migrateExtensionSettings";

const v0_3_0: ExtensionSettingsV0 = {
    dataPath: "/tmcdata",
};

const v0_5_0: ExtensionSettingsV0 = {
    dataPath: "/tmcdata",
    logLevel: LogLevelV0.Verbose,
    hideMetaFiles: true,
};

const v0_9_0: ExtensionSettingsV0 = {
    dataPath: "/tmcdata",
    hideMetaFiles: true,
    insiderVersion: true,
    logLevel: LogLevelV0.Verbose,
    oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
};

const v1_0_0: ExtensionSettingsV0 = {
    dataPath: "/tmcdata",
    downloadOldSubmission: false,
    hideMetaFiles: true,
    insiderVersion: true,
    logLevel: LogLevelV0.Verbose,
    oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
};

const v1_2_0: ExtensionSettingsV0 = {
    dataPath: "/tmcdata",
    downloadOldSubmission: false,
    hideMetaFiles: true,
    insiderVersion: true,
    logLevel: LogLevelV0.Verbose,
    oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
    updateExercisesAutomatically: false,
};

const v2_0_0: ExtensionSettingsV1 = {
    downloadOldSubmission: false,
    hideMetaFiles: true,
    insiderVersion: true,
    logLevel: "verbose",
    updateExercisesAutomatically: false,
};

export { v0_3_0, v0_5_0, v0_9_0, v1_0_0, v1_2_0, v2_0_0 };
