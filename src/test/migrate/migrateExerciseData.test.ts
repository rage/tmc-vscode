import { expect } from "chai";
import * as mockFs from "mock-fs";
import { Ok } from "ts-results";
import { IMock, It, Mock, Times } from "typemoq";
import * as vscode from "vscode";

import TMC from "../../api/tmc";
import migrateExerciseData from "../../migrate/migrateExerciseData";
import * as exerciseData from "../fixtures/exerciseData";
import { createMockMemento } from "../mocks/vscode";

const EXERCISE_DATA_KEY_V0 = "exerciseData";
const UNSTABLE_EXTENSION_SETTINGS_KEY = "extensionSettings";

suite("Exercise data migration", function () {
    const virtualFileSystem = {
        "/tmcdata/TMC workspace/": {
            Exercises: { test: { "test-python-course": { hello_world: {} } } },
            "closed-exercises": { "2": {} },
        },
    };

    let memento: vscode.Memento;
    let tmcMock: IMock<TMC>;

    setup(function () {
        memento = createMockMemento();
        tmcMock = Mock.ofType<TMC>();
        tmcMock
            .setup((x) =>
                x.migrateExercise(It.isAny(), It.isAny(), It.isAny(), It.isAny(), It.isAny()),
            )
            .returns(async () => Ok.EMPTY);
        tmcMock
            .setup((x) => x.setSetting("closed-exercises-for:test-python-course", It.isAny()))
            .returns(async () => Ok.EMPTY);
    });

    suite("between versions", function () {
        test("should succeed without any data", async function () {
            const migrated = await migrateExerciseData(memento, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([]);
        });

        test("should succeed with version 0.1.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_1_0);
            const migrated = await migrateExerciseData(memento, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.2.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_2_0);
            const migrated = await migrateExerciseData(memento, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.3.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath: "/tmcdata" });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_3_0);
            const migrated = await migrateExerciseData(memento, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.9.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath: "/tmcdata" });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_9_0);
            const migrated = await migrateExerciseData(memento, tmcMock.object);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXERCISE_DATA_KEY_V0, { ironman: "Tony Stark" });
            expect(migrateExerciseData(memento, tmcMock.object)).to.be.rejectedWith(/missmatch/);
        });

        test("should set closed exercises to TMC-langs", async function () {
            mockFs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath: "/tmcdata" });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_3_0);
            await migrateExerciseData(memento, tmcMock.object);
            const testValue = JSON.stringify(["other_world"]);
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

    teardown(function () {
        mockFs.restore();
    });
});
