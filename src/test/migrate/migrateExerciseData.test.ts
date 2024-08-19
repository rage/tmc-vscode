import { expect } from "chai";
import { IMock, It, Times } from "typemoq";
import * as vscode from "vscode";

import Dialog from "../../api/dialog";
import TMC from "../../api/tmc";
import migrateExerciseData from "../../migrate/migrateExerciseData";
import { Logger, LogLevel } from "../../utilities";
import * as exerciseData from "../fixtures/exerciseData";
import { createDialogMock } from "../mocks/dialog";
import { createTMCMock } from "../mocks/tmc";
import { createMockMemento } from "../mocks/vscode";
import { makeTmpDirs } from "../utils";

const EXERCISE_DATA_KEY_V0 = "exerciseData";
const UNSTABLE_EXTENSION_SETTINGS_KEY = "extensionSettings";

suite("Exercise data migration", function () {
    const virtualFileSystem = {
        "/TMC workspace/": {
            Exercises: { test: { "test-python-course": { hello_world: {} } } },
            "closed-exercises": { "2": {} },
        },
    };

    let dialogMock: IMock<Dialog>;
    let memento: vscode.Memento;
    let tmcMock: IMock<TMC>;

    setup(function () {
        [dialogMock] = createDialogMock();
        memento = createMockMemento();
        [tmcMock] = createTMCMock();
        Logger.configure(LogLevel.Verbose);
    });

    suite("between versions", function () {
        test("should succeed without any data", async function () {
            const migrated = await migrateExerciseData(memento, dialogMock.object, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([]);
        });

        test("should succeed with version 0.1.0 data", async function () {
            const dataPath = makeTmpDirs(virtualFileSystem);
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_1_0(dataPath));
            const migrated = await migrateExerciseData(memento, dialogMock.object, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.2.0 data", async function () {
            const dataPath = makeTmpDirs(virtualFileSystem);
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_2_0(dataPath));
            const migrated = await migrateExerciseData(memento, dialogMock.object, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.3.0 data", async function () {
            const dataPath = makeTmpDirs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_3_0);
            const migrated = await migrateExerciseData(memento, dialogMock.object, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.9.0 data", async function () {
            const dataPath = makeTmpDirs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_9_0);
            const migrated = await migrateExerciseData(memento, dialogMock.object, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXERCISE_DATA_KEY_V0, { ironman: "Tony Stark" });
            expect(
                migrateExerciseData(memento, dialogMock.object, tmcMock.object),
            ).to.be.rejectedWith(/mismatch/);
        });

        test("should set closed exercises to TMC-langs", async function () {
            const dataPath = makeTmpDirs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_3_0);
            await migrateExerciseData(memento, dialogMock.object, tmcMock.object);
            const testValue = ["other_world"];
            tmcMock.verify(
                (x) =>
                    x.setSetting(
                        It.isValue("closed-exercises-for:test-python-course"),
                        It.isValue(testValue),
                    ),
                Times.once(),
            );
        });
    });
});
