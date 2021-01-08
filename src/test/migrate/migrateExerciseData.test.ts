import { expect } from "chai";
import * as mockFs from "mock-fs";
import { Ok, Result } from "ts-results";
import { Mock } from "typemoq";
import * as vscode from "vscode";

import TMC from "../../api/tmc";
import migrateExerciseData from "../../migrate/migrateExerciseData";
import { createMockMemento } from "../__mocks__/vscode";
import * as exerciseData from "../fixtures/exerciseData";

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
    let tmc: TMC;

    setup(function () {
        memento = createMockMemento();
        const mockTMC = Mock.ofType<TMC>();
        mockTMC
            .setup((x) => x.migrateExercise)
            .returns(() => (): Promise<Result<void, Error>> => Promise.resolve(Ok.EMPTY));
        tmc = mockTMC.object;
    });

    suite("between versions", function () {
        test("should succeed without any data", async function () {
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([]);
        });

        test("should succeed with version 0.1.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_1_0);
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.2.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_2_0);
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.3.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath: "/tmcdata" });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_3_0);
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });

        test("should succeed with version 0.9.0 data", async function () {
            mockFs(virtualFileSystem);
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, { dataPath: "/tmcdata" });
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData.v0_9_0);
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.data).to.be.undefined;
            expect(migrated.obsoleteKeys).to.be.deep.equal([EXERCISE_DATA_KEY_V0]);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXERCISE_DATA_KEY_V0, { ironman: "Tony Stark" });
            expect(migrateExerciseData(memento, tmc)).to.be.rejectedWith(/missmatch/);
        });
    });

    teardown(function () {
        mockFs.restore();
    });
});
