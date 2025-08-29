import { expect } from "chai";
import * as tmp from "tmp";
import * as vscode from "vscode";

import {
    LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../../config/constants";
import { v0 } from "../../storage/data";
import * as exerciseData from "../fixtures/exerciseData";
import * as userData from "../fixtures/userData";
import { createMockMemento } from "../mocks/vscode";
import migrateUserDataToLatest from "../../storage/migration/userData";

const UNSTABLE_EXERCISE_DATA_KEY = "exerciseData";
const USER_DATA_KEY_V0 = "userData";
const USER_DATA_KEY_V1 = "user-data-v1";

suite("User data migration", function () {
    let memento: vscode.Memento;
    let root: string;

    setup(function () {
        memento = createMockMemento();
        root = tmp.dirSync().name;
    });

    suite("between versions", function () {
        test("should succeed without any data", function () {
            expect(migrateUserDataToLatest(memento).data).to.be.undefined;
        });

        test("should succeed with version 0.1.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v0_1_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.id).to.be.equal(0);
            expect(migratedCourse?.description).to.be.equal("Python Course");
            expect(migratedCourse?.exercises.length).to.be.equal(2);
            expect(migratedCourse?.name).to.be.equal("test-python-course");
            expect(migratedCourse?.organization).to.be.equal("test");
            expect(migratedCourse?.title).to.be.equal("test-python-course");
        });

        test("should succeed with version 0.2.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v0_2_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.availablePoints).to.be.equal(3);
            expect(migratedCourse?.awardedPoints).to.be.equal(0);
        });

        test("should succeed with version 0.3.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v0_3_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.newExercises).to.be.deep.equal([2, 3, 4]);
            expect(migratedCourse?.notifyAfter).to.be.equal(1234);
        });

        test("should succeed with version 0.4.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v0_4_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.title).to.be.equal("The Python Course");
        });

        test("should succeed with version 0.6.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v0_6_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.exercises.find((x) => x.id === 1)?.name).to.be.equal(
                "hello_world",
            );
            expect(migratedCourse?.exercises.find((x) => x.id === 2)?.name).to.be.equal(
                "other_world",
            );
        });

        test("should succeed with version 0.8.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v0_8_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.perhapsExamMode).to.be.true;
        });

        test("should succeed with version 0.9.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v0_9_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.disabled).to.be.true;
            expect(migratedCourse?.materialUrl).to.be.equal("mooc.fi");
        });

        test("should succeed with version 1.0.0 data", async function () {
            await memento.update(USER_DATA_KEY_V0, userData.v1_0_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];
            expect(migratedCourse?.disabled).to.be.true;
            expect(migratedCourse?.materialUrl).to.be.equal("mooc.fi");
        });

        test("should succeed with version 2.0.0 data", async function () {
            await memento.update(USER_DATA_KEY_V1, userData.v2_0_0);
            const courses = migrateUserDataToLatest(memento).data?.courses;
            courses?.forEach((course) => {
                course.exercises.forEach((x) => {
                    expect(x.availablePoints).to.be.equal(
                        LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
                    );
                    if (x.passed) {
                        expect(x.awardedPoints).to.be.equal(
                            LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
                        );
                    } else {
                        expect(x.awardedPoints).to.be.equal(
                            LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
                        );
                    }
                });
            });
        });

        test("should succeed with version 2.1.0 data", async function () {
            await memento.update(USER_DATA_KEY_V1, userData.v2_1_0);
            expect(migrateUserDataToLatest(memento).data).to.be.deep.equal(userData.v2_1_0);
        });

        test("should succeed with backwards compatible future data", async function () {
            const data = { ...userData.v2_1_0, batman: "Bruce Wayne" };
            await memento.update(USER_DATA_KEY_V1, data);
            expect(migrateUserDataToLatest(memento).data).to.be.deep.equal(data);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(USER_DATA_KEY_V0, { batman: "Bruce Wayne" });
            expect(() => migrateUserDataToLatest(memento)).to.throw(/mismatch/);
        });

        test("should find more exercise info from old exerciseData", async function () {
            await memento.update(UNSTABLE_EXERCISE_DATA_KEY, exerciseData.v0_1_0(root));
            await memento.update(USER_DATA_KEY_V0, userData.v0_1_0);
            const migratedCourse = migrateUserDataToLatest(memento).data?.courses[0];

            const exercise1 = migratedCourse?.exercises.find((x) => x.id === 1);
            expect(exercise1?.deadline).to.be.equal("20201214");
            expect(exercise1?.name).to.be.equal("hello_world");
            expect(exercise1?.softDeadline).to.be.null;

            const exercise2 = migratedCourse?.exercises.find((x) => x.id === 2);
            expect(exercise2?.deadline).to.be.equal("20201214");
            expect(exercise2?.name).to.be.equal("other_world");
            expect(exercise2?.softDeadline).to.be.null;
        });

        test("should successfully map unstable data with multiple courses", async function () {
            const courses: v0.LocalCourseData[] = [
                {
                    id: 0,
                    description: "",
                    exercises: [
                        { id: 1, passed: false },
                        { id: 2, passed: false },
                    ],
                    name: "test-python-course",
                    organization: "test",
                },
                {
                    id: 1,
                    description: "",
                    exercises: [
                        { id: 11, passed: true },
                        { id: 12, passed: false },
                    ],
                    name: "test-java-course",
                    organization: "test",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migrated = migrateUserDataToLatest(memento).data?.courses;
            expect(migrated?.length).to.be.equal(2);
            expect(migrated?.find((x) => x.id === 0)?.name).to.be.equal("test-python-course");
            expect(migrated?.find((x) => x.id === 1)?.name).to.be.equal("test-java-course");
        });
    });

    suite("with stable data", function () {
        test("should fail with garbage version 1 data", async function () {
            await memento.update(USER_DATA_KEY_V1, { batman: "Bruce Wayne" });
            expect(() => migrateUserDataToLatest(memento)).to.throw(/mismatch/);
        });
    });
});
