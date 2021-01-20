import { expect } from "chai";
import * as mockFs from "mock-fs";
import { Err, Ok } from "ts-results";
import { IMock, It, Mock } from "typemoq";
import * as vscode from "vscode";

import Storage from "../../api/storage";
import TMC from "../../api/tmc";
import { migrateExtensionDataFromPreviousVersions } from "../../migrate";
import { createMockContext } from "../__mocks__/vscode";
import * as exerciseData from "../fixtures/exerciseData";
import * as extensionSettings from "../fixtures/extensionSettings";
import * as sessionState from "../fixtures/sessionState";
import * as userData from "../fixtures/userData";

const UNSTABLE_EXERCISE_DATA_KEY = "exerciseData";
const UNSTABLE_EXTENSION_SETTINGS_KEY = "extensionSettings";
const UNSTABLE_USER_DATA_KEY = "userData";

const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1";
const SESSION_STATE_KEY_V1 = "session-state-v1";
const USER_DATA_KEY_V1 = "user-data-v1";

suite("Extension data migration", function () {
    const virtualFileSystem = {
        "/tmcdata/TMC workspace/": {
            Exercises: { test: { "test-python-course": { hello_world: {} } } },
            "closed-exercises": { "2": {} },
        },
    };

    let context: vscode.ExtensionContext;
    let tmcSuccess: IMock<TMC>;
    let tmcFail: IMock<TMC>;
    let storage: Storage;

    setup(function () {
        mockFs(virtualFileSystem);
        context = createMockContext();
        storage = new Storage(context);
        tmcFail = Mock.ofType<TMC>();
        tmcFail
            .setup((x) =>
                x.migrateExercise(It.isAny(), It.isAny(), It.isAny(), It.isAny(), It.isAny()),
            )
            .returns(async () => Err(new Error()));
        tmcFail
            .setup((x) => x.setSetting(It.isValue("closed-exercises"), It.isAny()))
            .returns(async () => Err(new Error()));
        tmcFail
            .setup((x) => x.getSetting(It.isValue("projects-dir")))
            .returns(async () => Err(new Error()));
        tmcSuccess = Mock.ofType<TMC>();
        tmcSuccess
            .setup((x) =>
                x.migrateExercise(It.isAny(), It.isAny(), It.isAny(), It.isAny(), It.isAny()),
            )
            .returns(async () => Ok.EMPTY);
        tmcSuccess
            .setup((x) => x.setSetting(It.isValue("closed-exercises"), It.isAny()))
            .returns(async () => Ok.EMPTY);
        tmcSuccess
            .setup((x) => x.getSetting(It.isValue("projects-dir")))
            .returns(async () => Ok("/langs/path/to/exercises"));
    });

    test("should succeed without any data", async function () {
        const result = await migrateExtensionDataFromPreviousVersions(
            context,
            storage,
            tmcSuccess.object,
        );
        expect(result.ok).to.be.true;
    });

    test("should be compatible with extended future data");

    suite("from version 0.1.0", function () {
        test("should succeed with valid data", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_1_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_1_0);
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcSuccess.object,
            );
            expect(result).to.be.equal(Ok.EMPTY);
            expect(storage.getUserData()).to.not.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.undefined;
        });

        test("should not change anything if Langs fails", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_1_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_1_0);
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcFail.object,
            );
            expect(result.val).to.be.instanceOf(Error);
            expect(storage.getUserData()).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.equal(
                exerciseData.v0_1_0,
            );
            expect(context.globalState.get(UNSTABLE_USER_DATA_KEY)).to.be.equal(userData.v0_1_0);
        });
    });

    suite("from version 0.2.0", function () {
        test("should succeed with valid data", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_2_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_2_0);
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcSuccess.object,
            );
            expect(result).to.be.equal(Ok.EMPTY);
            expect(storage.getUserData()).to.not.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.undefined;
        });

        test("should not modify data if Langs fails", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_2_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_2_0);
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcFail.object,
            );
            expect(result.val).to.be.instanceOf(Error);
            expect(storage.getUserData()).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.equal(
                exerciseData.v0_2_0,
            );
            expect(context.globalState.get(UNSTABLE_USER_DATA_KEY)).to.be.equal(userData.v0_2_0);
        });
    });

    suite("from version 0.3.0", function () {
        test("should succeed with valid data", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_3_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_3_0);
            await context.globalState.update(
                UNSTABLE_EXTENSION_SETTINGS_KEY,
                extensionSettings.v0_3_0,
            );
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcSuccess.object,
            );
            expect(result).to.be.equal(Ok.EMPTY);
            expect(storage.getUserData()).to.not.be.undefined;
            expect(storage.getExtensionSettings()).to.not.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXTENSION_SETTINGS_KEY)).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_USER_DATA_KEY)).to.be.undefined;
        });

        test("should not modify data if Langs fails", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_3_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_3_0);
            await context.globalState.update(
                UNSTABLE_EXTENSION_SETTINGS_KEY,
                extensionSettings.v0_3_0,
            );
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcFail.object,
            );
            expect(result.val).to.be.instanceOf(Error);
            expect(storage.getUserData()).to.be.undefined;
            expect(storage.getExtensionSettings()).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.equal(
                exerciseData.v0_3_0,
            );
            expect(context.globalState.get(UNSTABLE_EXTENSION_SETTINGS_KEY)).to.be.equal(
                extensionSettings.v0_3_0,
            );
            expect(context.globalState.get(UNSTABLE_USER_DATA_KEY)).to.be.equal(userData.v0_3_0);
        });
    });

    suite("from version 0.9.0", function () {
        test("should succeed with valid data", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_9_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_9_0);
            await context.globalState.update(
                UNSTABLE_EXTENSION_SETTINGS_KEY,
                extensionSettings.v0_9_0,
            );
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcSuccess.object,
            );
            expect(result).to.be.equal(Ok.EMPTY);
            expect(storage.getUserData()).to.not.be.undefined;
            expect(storage.getExtensionSettings()).to.not.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXTENSION_SETTINGS_KEY)).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_USER_DATA_KEY)).to.be.undefined;
        });

        test("should not modify data if Langs fails", async function () {
            await context.globalState.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_9_0);
            await context.globalState.update(UNSTABLE_USER_DATA_KEY, userData.v0_9_0);
            await context.globalState.update(
                UNSTABLE_EXTENSION_SETTINGS_KEY,
                extensionSettings.v0_9_0,
            );
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcFail.object,
            );
            expect(result.val).to.be.instanceOf(Error);
            expect(storage.getUserData()).to.be.undefined;
            expect(storage.getExtensionSettings()).to.be.undefined;
            expect(context.globalState.get(UNSTABLE_EXERCISE_DATA_KEY)).to.be.equal(
                exerciseData.v0_9_0,
            );
            expect(context.globalState.get(UNSTABLE_EXTENSION_SETTINGS_KEY)).to.be.equal(
                extensionSettings.v0_9_0,
            );
            expect(context.globalState.get(UNSTABLE_USER_DATA_KEY)).to.be.equal(userData.v0_9_0);
        });
    });

    suite("from version 2.0.0", function () {
        test("should succeed with valid data", async function () {
            await context.globalState.update(USER_DATA_KEY_V1, userData.v2_0_0);
            await context.globalState.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0);
            await context.globalState.update(SESSION_STATE_KEY_V1, sessionState.v2_0_0);
            const result = await migrateExtensionDataFromPreviousVersions(
                context,
                storage,
                tmcSuccess.object,
            );
            expect(result).to.be.equal(Ok.EMPTY);
            expect(storage.getUserData()).to.not.be.undefined;
            expect(storage.getExtensionSettings()).to.not.be.undefined;
            expect(storage.getSessionState()).to.not.be.undefined;
        });
    });

    teardown(function () {
        mockFs.restore();
    });
});
