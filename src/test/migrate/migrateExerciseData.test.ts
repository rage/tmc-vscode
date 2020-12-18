import { expect } from "chai";
import * as mockFs from "mock-fs";
import { Ok, Result } from "ts-results";
import { Mock } from "typemoq";
import * as vscode from "vscode";

import TMC from "../../api/tmc";
import migrateExerciseData, {
    ExerciseStatusV0,
    LocalExerciseDataV0,
} from "../../migrate/migrateExerciseData";
import { createMockMemento } from "../__mocks__/vscode";

const EXERCISE_DATA_KEY_V0 = "exerciseData";
const UNSTABLE_EXTENSION_SETTINGS_KEY = "extensionSettings";

suite("Exercise data migration", function () {
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
            expect(migrated.ok).to.be.true;
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
            mockFs({ "/path/to/exercise": {} });
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.ok).to.be.true;
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
            mockFs({ "/path/to/exercise": {} });
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.ok).to.be.true;
        });

        test("should succeed with version 0.3.0 data", async function () {
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, {
                dataPath: "/path/to/workspace",
            });
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
            mockFs({
                "/path/to/workspace/TMC workspace/Exercises/test/test-python-course/hello_world": {},
            });
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.ok).to.be.true;
        });

        test("should succeed with version 0.9.0 data", async function () {
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, {
                dataPath: "/path/to/workspace",
            });
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
            mockFs({
                "/path/to/workspace/TMC workspace/Exercises/test/test-python-course/hello_world": {},
            });
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.ok).to.be.true;
        });

        test("should succeed with version 1.0.0 data", async function () {
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, {
                dataPath: "/path/to/workspace",
            });
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
            mockFs({
                "/path/to/workspace/TMC workspace/Exercises/test/test-python-course/hello_world": {},
            });
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.ok).to.be.true;
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(EXERCISE_DATA_KEY_V0, { ironman: "Tony Stark" });
            expect(migrateExerciseData(memento, tmc)).to.be.rejectedWith(/missmatch/);
        });

        test("should resolve old closed-exercises folder location", async function () {
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, {
                dataPath: "/path/to/workspace",
            });
            const exerciseData: LocalExerciseDataV0[] = [
                {
                    id: 2,
                    checksum: "def456",
                    course: "test-python-course",
                    deadline: "20201214",
                    name: "other_world",
                    organization: "test",
                    softDeadline: "20201212",
                    status: ExerciseStatusV0.CLOSED,
                    updateAvailable: false,
                },
            ];
            await memento.update(EXERCISE_DATA_KEY_V0, exerciseData);
            mockFs({ "/path/to/workspace/TMC workspace/closed-exercises/2": {} });
            const migrated = await migrateExerciseData(memento, tmc);
            expect(migrated.ok).to.be.true;
        });
    });

    teardown(function () {
        mockFs.restore();
    });
});
