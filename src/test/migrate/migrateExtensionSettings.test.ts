import { use as chaiUse, expect } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import { Ok, Result } from "ts-results";
import { Mock } from "typemoq";
import * as vscode from "vscode";

import TMC from "../../api/tmc";
import migrateExtensionSettings, {
    ExtensionSettingsV0,
    ExtensionSettingsV1,
    LogLevelV0,
    LogLevelV1,
} from "../../migrate/migrateExtensionSettings";
import { LogLevel } from "../../utils";
import { createMockMemento } from "../__mocks__/vscode";

chaiUse(chaiAsPromised);

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings";
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";

suite("Extension settings migration", function () {
    const dataPath = "/old/path/to/exercises";
    const migratedDataPath = "/migrated/path/to/exercises";

    let memento: vscode.Memento;
    let tmc: TMC;

    setup(function () {
        memento = createMockMemento();
        const mockTMC = Mock.ofType<TMC>();
        mockTMC
            .setup((x) => x.getSetting)
            .returns(() => (): Promise<Result<string, Error>> =>
                Promise.resolve(Ok(migratedDataPath)),
            );
        tmc = mockTMC.object;
    });

    suite("between versions", function () {
        test("should succeed without any data", async function () {
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
            expect(migrated).to.be.undefined;
        });

        test("should succeed with version 0.3.0 data", async function () {
            const extensionSettings: ExtensionSettingsV0 = { dataPath };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
            expect(migrated?.dataPath).to.be.equal(migratedDataPath);
        });

        test("should succeed with version 0.5.0 data", async function () {
            const extensionSettings: ExtensionSettingsV0 = {
                dataPath,
                logLevel: LogLevelV0.Verbose,
                hideMetaFiles: true,
            };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
            expect(migrated?.logLevel).to.be.equal("verbose");
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
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
            expect(migrated?.insiderVersion).to.be.true;
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
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
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
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
            expect(migrated?.updateExercisesAutomatically).to.be.false;
        });

        test("should succeed with version 2.0.0 data", async function () {
            const extensionSettings: ExtensionSettingsV1 = {
                dataPath,
                downloadOldSubmission: false,
                hideMetaFiles: true,
                insiderVersion: true,
                logLevel: "verbose",
                updateExercisesAutomatically: false,
            };
            await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings);
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
            expect(migrated).to.be.deep.equal(extensionSettings);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, { superman: "Clark Kent" });
            expect(migrateExtensionSettings(memento, tmc)).to.be.rejectedWith(/missmatch/);
        });

        test("should set valid placeholders with minimal data", async function () {
            const extensionSettings: ExtensionSettingsV0 = { dataPath };
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
            const migrated = (await migrateExtensionSettings(memento, tmc)).data;
            expect(migrated?.downloadOldSubmission).to.be.true;
            expect(migrated?.hideMetaFiles).to.be.true;
            expect(migrated?.insiderVersion).to.be.false;
            expect(migrated?.logLevel).to.be.equal(LogLevel.Errors);
            expect(migrated?.updateExercisesAutomatically).to.be.true;
        });

        test("should remap logger values properly", async function () {
            const expectedRemappings: [LogLevelV0, LogLevelV1][] = [
                [LogLevelV0.Debug, "verbose"],
                [LogLevelV0.Errors, "errors"],
                [LogLevelV0.None, "none"],
                [LogLevelV0.Verbose, "verbose"],
            ];
            for (const [oldLevel, expectedLevel] of expectedRemappings) {
                const extensionSettings: ExtensionSettingsV0 = { dataPath, logLevel: oldLevel };
                await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings);
                const migrated = (await migrateExtensionSettings(memento, tmc)).data;
                expect(migrated?.logLevel).to.be.equal(expectedLevel);
            }
        });
    });

    suite("with stable data", function () {
        test("should fail with garbage version 1 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, { superman: "Clark Kent" });
            expect(migrateExtensionSettings(memento, tmc)).to.be.rejectedWith(/missmatch/);
        });
    });
});
