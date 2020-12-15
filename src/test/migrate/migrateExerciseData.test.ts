import { expect } from "chai";
import * as path from "path";
import * as vscode from "vscode";

import {
    ExerciseStatusV0,
    ExerciseStatusV1,
    LocalExerciseDataV0,
    LocalExerciseDataV1,
    migrateExerciseData,
} from "../../migrate/migrateExerciseData";
import { createMockMemento } from "../__mocks__/vscode";

const EXERCISE_DATA_KEY_V0 = "exerciseData";
const EXERCISE_DATA_KEY_V1 = "exercise-data-v1";

suite("Exercise data migration", function () {
    const fixturePath = vscode.Uri.file(path.join(__dirname, "..", "__fixtures__"));

    let memento: vscode.Memento;

    setup(function () {
        memento = createMockMemento();
    });

    suite("between versions", function () {
        test("should succeed without any data", function () {
            expect(migrateExerciseData(memento, fixturePath).data).to.be.undefined;
        });

        test("should succeed with version 0.1.0 data", async function () {
            const exerciseData: LocalExerciseDataV0[] = [
                {
                    id: 1,
                    checksum: "abc123",
                    course: "test-python-course",
                    deadline: "20201214",
                    name: "hello_world",
                    organization: "test",
                    path: "/path/to/exercise",
                    isOpen: true,
                },
            ];
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData);
            const migrated = migrateExerciseData(memento, fixturePath).data?.[0];
            expect(migrated?.id).to.be.equal(1);
            expect(migrated?.checksum).to.be.equal("abc123");
            expect(migrated?.course).to.be.equal("test-python-course");
            expect(migrated?.name).to.be.equal("hello_world");
            expect(migrated?.organization).to.be.equal("test");
            expect(migrated?.path).to.be.equal("/path/to/exercise");
            expect(migrated?.status).to.be.equal(ExerciseStatusV1.OPEN);
        });

        test("should succeed with version 0.2.0 data", async function () {
            const exerciseData: LocalExerciseDataV0[] = [
                {
                    id: 1,
                    checksum: "abc123",
                    course: "test-python-course",
                    deadline: "20201214",
                    name: "hello_world",
                    organization: "test",
                    path: "/path/to/exercise",
                    softDeadline: "20201212",
                    status: ExerciseStatusV0.OPEN,
                    updateAvailable: true,
                },
            ];
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData);
            const migrated = migrateExerciseData(memento, fixturePath).data?.[0];
            expect(migrated?.status).to.be.equal(ExerciseStatusV1.OPEN);
        });

        test("should succeed with version 0.3.0 data", async function () {
            const exerciseData: LocalExerciseDataV0[] = [
                {
                    id: 1,
                    checksum: "abc123",
                    course: "test-python-course",
                    deadline: "20201214",
                    name: "hello_world",
                    organization: "test",
                    softDeadline: "20201212",
                    status: ExerciseStatusV0.OPEN,
                    updateAvailable: true,
                },
            ];
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData);
            const migrated = migrateExerciseData(memento, fixturePath).data?.[0];
            const expectedPath = vscode.Uri.file(
                path.join(fixturePath.fsPath, "test", "test-python-course", "hello_world"),
            ).fsPath;
            expect(migrated?.path).to.be.equal(expectedPath);
        });

        test("should succeed with version 0.9.0 data", async function () {
            const exerciseData: LocalExerciseDataV0[] = [
                {
                    id: 1,
                    checksum: "abc123",
                    course: "test-python-course",
                    deadline: "20201214",
                    name: "hello_world",
                    organization: "test",
                    softDeadline: "20201212",
                    status: ExerciseStatusV0.OPEN,
                },
            ];
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData);
            expect(() => migrateExerciseData(memento, fixturePath)).to.not.throw();
        });

        test("should succeed with version 1.0.0 data", async function () {
            const exerciseData: LocalExerciseDataV0[] = [
                {
                    id: 1,
                    checksum: "abc123",
                    course: "test-python-course",
                    name: "hello_world",
                    organization: "test",
                    status: ExerciseStatusV0.OPEN,
                },
            ];
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData);
            expect(() => migrateExerciseData(memento, fixturePath)).to.not.throw();
        });

        test("should succeed with version 2.0.0 data", async function () {
            const exerciseData: LocalExerciseDataV1[] = [
                {
                    id: 1,
                    checksum: "abc123",
                    course: "test-python-course",
                    name: "hello_world",
                    organization: "test",
                    path: "/path/to/exercise",
                    status: ExerciseStatusV1.OPEN,
                },
            ];
            await memento.update(EXERCISE_DATA_KEY_V1, exerciseData);
            expect(migrateExerciseData(memento, fixturePath).data).to.be.deep.equal(exerciseData);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXERCISE_DATA_KEY_V0, { ironman: "Tony Stark" });
            expect(() => migrateExerciseData(memento, fixturePath)).to.throw(/missmatch/);
        });

        test("should resolve old closed-exercises folder location");
    });

    suite("with stable data", function () {
        test("should fail with garbage version 1 data", async function () {
            await memento.update(EXERCISE_DATA_KEY_V1, { ironman: "Tony Stark" });
            expect(() => migrateExerciseData(memento, fixturePath)).to.throw(/missmatch/);
        });
    });
});
