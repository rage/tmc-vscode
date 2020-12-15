import { expect } from "chai";
import * as vscode from "vscode";

import {
    ExtensionSettingsV0,
    ExtensionSettingsV1,
    LogLevelV0,
    LogLevelV1,
    migrateExtensionSettings,
} from "../../migrate/migrateExtensionSettings";
import { LogLevel } from "../../utils";
import { createMockMemento } from "../__mocks__/vscode";

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings";
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";

suite("Extension settings migration", function () {
    const dataPath = "/path/to/exercises";

    let memento: vscode.Memento;

    setup(function () {
        memento = createMockMemento();
    });

    suite("between versions", function () {
        test("should succeed without any data", function () {
            expect(migrateExtensionSettings(memento).data).to.be.undefined;
        });

        test("should succeed with version 0.3.0 data", async function () {
            const extensionSettings: ExtensionSettingsV0 = { dataPath };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = migrateExtensionSettings(memento).data;
            expect(migrated?.dataPath).to.be.equal("/path/to/exercises");
        });

        test("should succeed with version 0.5.0 data", async function () {
            const extensionSettings: ExtensionSettingsV0 = {
                dataPath,
                logLevel: LogLevelV0.Verbose,
                hideMetaFiles: true,
            };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = migrateExtensionSettings(memento).data;
            expect(migrated?.logLevel).to.be.equal(LogLevelV1.Verbose);
            expect(migrated?.hideMetaFiles).to.be.true;
        });

        test("should succeed with version 0.9.0 data", async function () {
            const extensionSettings: ExtensionSettingsV0 = {
                dataPath,
                hideMetaFiles: true,
                insiderVersion: true,
                logLevel: LogLevelV0.Verbose,
                oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
            };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = migrateExtensionSettings(memento).data;
            expect(migrated?.insiderVersion).to.be.true;
            expect(migrated?.oldDataPath?.path).to.be.equal("/old/path/to/exercises");
            expect(migrated?.oldDataPath?.timestamp).to.be.equal(1234);
        });

        test("should succeed with version 1.0.0 data", async function () {
            const extensionSettings: ExtensionSettingsV0 = {
                dataPath,
                downloadOldSubmission: false,
                hideMetaFiles: true,
                insiderVersion: true,
                logLevel: LogLevelV0.Verbose,
                oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
            };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = migrateExtensionSettings(memento).data;
            expect(migrated?.downloadOldSubmission).to.be.false;
        });

        test("should succeed with version 1.2.0 data", async function () {
            const extensionSettings: ExtensionSettingsV0 = {
                dataPath,
                downloadOldSubmission: false,
                hideMetaFiles: true,
                insiderVersion: true,
                logLevel: LogLevelV0.Verbose,
                oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
                updateExercisesAutomatically: false,
            };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = migrateExtensionSettings(memento).data;
            expect(migrated?.updateExercisesAutomatically).to.be.false;
        });

        test("should succeed with version 2.0.0 data", async function () {
            const extensionSettings: ExtensionSettingsV1 = {
                dataPath,
                downloadOldSubmission: false,
                hideMetaFiles: true,
                insiderVersion: true,
                logLevel: LogLevelV1.Verbose,
                oldDataPath: { path: "/old/path/to/exercises", timestamp: 1234 },
                updateExercisesAutomatically: false,
            };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = migrateExtensionSettings(memento).data;
            expect(migrated).to.be.deep.equal(extensionSettings);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, { superman: "Clark Kent" });
            expect(() => migrateExtensionSettings(memento)).to.throw(/missmatch/);
        });

        test("should set valid placeholders with minimal data", async function () {
            const extensionSettings: ExtensionSettingsV0 = { dataPath };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = migrateExtensionSettings(memento).data;
            expect(migrated?.downloadOldSubmission).to.be.true;
            expect(migrated?.hideMetaFiles).to.be.true;
            expect(migrated?.insiderVersion).to.be.false;
            expect(migrated?.logLevel).to.be.equal(LogLevel.Errors);
            expect(migrated?.oldDataPath).to.be.undefined;
            expect(migrated?.updateExercisesAutomatically).to.be.true;
        });

        test("should remap logger values properly", async function () {
            const expectedRemappings: [LogLevelV0, LogLevelV1][] = [
                [LogLevelV0.Debug, LogLevelV1.Verbose],
                [LogLevelV0.Errors, LogLevelV1.Errors],
                [LogLevelV0.None, LogLevelV1.None],
                [LogLevelV0.Verbose, LogLevelV1.Verbose],
            ];
            for (const [oldLevel, expectedLevel] of expectedRemappings) {
                const extensionSettings: ExtensionSettingsV0 = { dataPath, logLevel: oldLevel };
                await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
                expect(migrateExtensionSettings(memento).data?.logLevel).to.be.equal(expectedLevel);
            }
        });
    });

    suite("with stable data", function () {
        test("should fail with garbage version 1 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, { superman: "Clark Kent" });
            expect(() => migrateExtensionSettings(memento)).to.throw(/missmatch/);
        });
    });
});
