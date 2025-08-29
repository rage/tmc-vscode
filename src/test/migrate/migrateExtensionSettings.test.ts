import migrateExtensionSettings, {
    ExtensionSettingsV0,
    LogLevelV0,
    LogLevelV1,
} from "../../migrate/migrateExtensionSettings";
import { LogLevel } from "../../utilities";
import * as extensionSettings from "../fixtures/extensionSettings";
import { createMockMemento, createMockWorkspaceConfiguration } from "../mocks/vscode";
import { expect, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as tmp from "tmp";
import { IMock, It, Times } from "typemoq";
import * as vscode from "vscode";

use(chaiAsPromised);

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings";
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";
const UNSTABLE_EXTENSION_VERSION_KEY = "extensionVersion";
const SESSION_STATE_KEY_V1 = "session-state-v1";

suite("Extension settings migration", function () {
    let memento: vscode.Memento;
    let settingsMock: IMock<vscode.WorkspaceConfiguration>;
    let root: string;

    setup(function () {
        memento = createMockMemento();
        settingsMock = createMockWorkspaceConfiguration();
        root = tmp.dirSync().name;
    });

    suite("to vscode settings API", function () {
        test("should not happen when no data", async function () {
            await migrateExtensionSettings(memento, settingsMock.object);
            settingsMock.verify((x) => x.update(It.isAny(), It.isAny(), It.isAny()), Times.never());
        });

        test("should happen when no version is defined", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_5_0(root));
            await migrateExtensionSettings(memento, settingsMock.object);
            settingsMock.verify(
                (x) => x.update(It.isAny(), It.isAny(), It.isAny()),
                Times.atLeastOnce(),
            );
        });

        test("should happen when old version is lower than 1.1.0", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_5_0(root));
            await memento.update(UNSTABLE_EXTENSION_VERSION_KEY, "0.1.0");
            await migrateExtensionSettings(memento, settingsMock.object);
            settingsMock.verify(
                (x) => x.update(It.isAny(), It.isAny(), It.isAny()),
                Times.atLeastOnce(),
            );
        });

        test("should happen when old version is lower than 2.1.0", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0);
            await memento.update(SESSION_STATE_KEY_V1, { extensionVersion: "2.0.2" });
            await migrateExtensionSettings(memento, settingsMock.object);
            settingsMock.verify(
                (x) => x.update(It.isAny(), It.isAny(), It.isAny()),
                Times.atLeastOnce(),
            );
        });

        test("should set correct values", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0);
            await memento.update(SESSION_STATE_KEY_V1, { extensionVersion: "2.0.2" });
            await migrateExtensionSettings(memento, settingsMock.object);
            settingsMock.verify(
                (x) =>
                    x.update(
                        It.isValue("testMyCode.insiderVersion"),
                        It.isValue(extensionSettings.v2_0_0.insiderVersion),
                        It.isAny(),
                    ),
                Times.once(),
            );
            settingsMock.verify(
                (x) =>
                    x.update(
                        It.isValue("testMyCode.downloadOldSubmission"),
                        It.isValue(extensionSettings.v2_0_0.downloadOldSubmission),
                        It.isAny(),
                    ),
                Times.once(),
            );
            settingsMock.verify(
                (x) =>
                    x.update(
                        It.isValue("testMyCode.hideMetaFiles"),
                        It.isValue(extensionSettings.v2_0_0.hideMetaFiles),
                        It.isAny(),
                    ),
                Times.once(),
            );
            settingsMock.verify(
                (x) =>
                    x.update(
                        It.isValue("testMyCode.logLevel"),
                        It.isValue(extensionSettings.v2_0_0.logLevel),
                        It.isAny(),
                    ),
                Times.once(),
            );
            settingsMock.verify(
                (x) =>
                    x.update(
                        It.isValue("testMyCode.updateExercisesAutomatically"),
                        It.isValue(extensionSettings.v2_0_0.updateExercisesAutomatically),
                        It.isAny(),
                    ),
                Times.once(),
            );
        });

        test("should not happen when version matches or is above 2.1.0", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0);
            await memento.update(SESSION_STATE_KEY_V1, { extensionVersion: "2.2.2" });
            await migrateExtensionSettings(memento, settingsMock.object);
            settingsMock.verify((x) => x.update(It.isAny(), It.isAny(), It.isAny()), Times.never());
        });
    });

    suite("between versions", function () {
        test("should succeed without any data", async function () {
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
            expect(migrated).to.be.undefined;
        });

        test("should succeed with version 0.5.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_5_0(root));
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
            expect(migrated?.logLevel).to.be.equal("verbose");
            expect(migrated?.hideMetaFiles).to.be.true;
        });

        test("should succeed with version 0.9.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_9_0(root));
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
            expect(migrated?.insiderVersion).to.be.true;
        });

        test("should succeed with version 1.0.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v1_0_0(root));
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
            expect(migrated?.downloadOldSubmission).to.be.false;
        });

        test("should succeed with version 1.2.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v1_2_0(root));
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
            expect(migrated?.updateExercisesAutomatically).to.be.false;
        });

        test("should succeed with version 2.0.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0);
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
            expect(migrated).to.be.deep.equal(extensionSettings.v2_0_0);
        });

        test("should succeed with backwards compatible future data", async function () {
            const data = { ...extensionSettings.v2_0_0, superman: "Clark Kent" };
            await memento.update(EXTENSION_SETTINGS_KEY_V1, data);
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
            expect(migrated).to.be.deep.equal(data);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, { superman: "Clark Kent" });
            expect(migrateExtensionSettings(memento, settingsMock.object)).to.be.rejectedWith(
                /mismatch/,
            );
        });

        test("should set valid placeholders with minimal data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, { dataPath: root });
            const migrated = (await migrateExtensionSettings(memento, settingsMock.object)).data;
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
                const oldSettings: ExtensionSettingsV0 = { dataPath: root, logLevel: oldLevel };
                await memento.update(EXTENSION_SETTINGS_KEY_V0, oldSettings);
                const migrated = (await migrateExtensionSettings(memento, settingsMock.object))
                    .data;
                expect(migrated?.logLevel).to.be.equal(expectedLevel);
            }
        });
    });

    suite("with stable data", function () {
        test("should fail with garbage version 1 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, { superman: "Clark Kent" });
            expect(migrateExtensionSettings(memento, settingsMock.object)).to.be.rejectedWith(
                /mismatch/,
            );
        });
    });
});
