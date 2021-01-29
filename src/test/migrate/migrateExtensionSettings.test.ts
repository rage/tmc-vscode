import { expect, use } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as vscode from "vscode";

import migrateExtensionSettings, {
    LogLevelV0,
    LogLevelV1,
} from "../../migrate/migrateExtensionSettings";
import { LogLevel } from "../../utils";
import * as extensionSettings from "../fixtures/extensionSettings";
import { createMockMemento } from "../mocks/vscode";

use(chaiAsPromised);

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings";
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";

suite("Extension settings migration", function () {
    let memento: vscode.Memento;

    setup(function () {
        memento = createMockMemento();
    });

    suite("between versions", function () {
        test("should succeed without any data", async function () {
            const migrated = (await migrateExtensionSettings(memento)).data;
            expect(migrated).to.be.undefined;
        });

        test("should succeed with version 0.5.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_5_0);
            const migrated = (await migrateExtensionSettings(memento)).data;
            expect(migrated?.logLevel).to.be.equal("verbose");
            expect(migrated?.hideMetaFiles).to.be.true;
        });

        test("should succeed with version 0.9.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_9_0);
            const migrated = (await migrateExtensionSettings(memento)).data;
            expect(migrated?.insiderVersion).to.be.true;
        });

        test("should succeed with version 1.0.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v1_0_0);
            const migrated = (await migrateExtensionSettings(memento)).data;
            expect(migrated?.downloadOldSubmission).to.be.false;
        });

        test("should succeed with version 1.2.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v1_2_0);
            const migrated = (await migrateExtensionSettings(memento)).data;
            expect(migrated?.updateExercisesAutomatically).to.be.false;
        });

        test("should succeed with version 2.0.0 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0);
            const migrated = (await migrateExtensionSettings(memento)).data;
            expect(migrated).to.be.deep.equal(extensionSettings.v2_0_0);
        });

        test("should succeed with backwards compatible future data", async function () {
            const data = { ...extensionSettings.v2_0_0, superman: "Clark Kent" };
            await memento.update(EXTENSION_SETTINGS_KEY_V1, data);
            const migrated = (await migrateExtensionSettings(memento)).data;
            expect(migrated).to.be.deep.equal(data);
        });
    });

    suite("with unstable data", function () {
        const dataPath = extensionSettings.v0_3_0.dataPath;

        test("should fail if data is garbage", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, { superman: "Clark Kent" });
            expect(migrateExtensionSettings(memento)).to.be.rejectedWith(/missmatch/);
        });

        test("should set valid placeholders with minimal data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V0, { dataPath });
            const migrated = (await migrateExtensionSettings(memento)).data;
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
                await memento.update(EXTENSION_SETTINGS_KEY_V0, { dataPath, logLevel: oldLevel });
                const migrated = (await migrateExtensionSettings(memento)).data;
                expect(migrated?.logLevel).to.be.equal(expectedLevel);
            }
        });
    });

    suite("with stable data", function () {
        test("should fail with garbage version 1 data", async function () {
            await memento.update(EXTENSION_SETTINGS_KEY_V1, { superman: "Clark Kent" });
            expect(migrateExtensionSettings(memento)).to.be.rejectedWith(/missmatch/);
        });
    });
});
