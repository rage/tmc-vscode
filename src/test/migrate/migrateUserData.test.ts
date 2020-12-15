import { expect } from "chai";
import * as vscode from "vscode";

import {
    LocalCourseDataV0,
    LocalCourseDataV1,
    migrateUserData,
} from "../../migrate/migrateUserData";
import { createMockMemento } from "../__mocks__/vscode";

const UNSTABLE_EXERCISE_DATA_KEY = "exerciseData";
const USER_DATA_KEY_V0 = "userData";
const USER_DATA_KEY_V1 = "user-data-v1";

suite("User data migration", function () {
    let memento: vscode.Memento;

    setup(function () {
        memento = createMockMemento();
    });

    suite("between versions", function () {
        test("should succeed without any data", function () {
            expect(migrateUserData(memento).data).to.be.undefined;
        });

        test("should succeed with version 0.1.0 data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    description: "Python Course",
                    exercises: [
                        { id: 1, passed: false },
                        { id: 2, passed: false },
                    ],
                    name: "test-python-course",
                    organization: "test",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.id).to.be.equal(0);
            expect(migratedCourse?.description).to.be.equal("Python Course");
            expect(migratedCourse?.exercises.length).to.be.equal(2);
            expect(migratedCourse?.name).to.be.equal("test-python-course");
            expect(migratedCourse?.organization).to.be.equal("test");
        });

        test("should succeed with version 0.2.0 data", async function () {
            const courses = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    exercises: [
                        { id: 1, passed: false },
                        { id: 2, passed: false },
                    ],
                    name: "test-python-course",
                    organization: "test",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.availablePoints).to.be.equal(3);
            expect(migratedCourse?.awardedPoints).to.be.equal(0);
        });

        test("should succeed with version 0.3.0 data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    exercises: [
                        { id: 1, passed: false },
                        { id: 2, passed: false },
                    ],
                    name: "test-python-course",
                    newExercises: [2, 3, 4],
                    notifyAfter: 1234,
                    organization: "test",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.newExercises).to.be.deep.equal([2, 3, 4]);
            expect(migratedCourse?.notifyAfter).to.be.equal(1234);
        });

        test("should succeed with version 0.4.0 data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    exercises: [
                        { id: 1, passed: false },
                        { id: 2, passed: false },
                    ],
                    name: "test-python-course",
                    newExercises: [2, 3, 4],
                    notifyAfter: 1234,
                    organization: "test",
                    title: "The Python Course",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.title).to.be.equal("The Python Course");
        });

        test("should succeed with version 0.6.0 data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    exercises: [
                        { id: 1, name: "hello_world", passed: false },
                        { id: 2, name: "other_hello_world", passed: false },
                    ],
                    name: "test-python-course",
                    newExercises: [2, 3, 4],
                    notifyAfter: 1234,
                    organization: "test",
                    title: "The Python Course",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.exercises.find((x) => x.id === 1)?.name).to.be.equal(
                "hello_world",
            );
            expect(migratedCourse?.exercises.find((x) => x.id === 2)?.name).to.be.equal(
                "other_hello_world",
            );
        });

        test("should succeed with version 0.8.0 data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    exercises: [
                        { id: 1, name: "hello_world", passed: false },
                        { id: 2, name: "other_hello_world", passed: false },
                    ],
                    name: "test-python-course",
                    newExercises: [2, 3, 4],
                    notifyAfter: 1234,
                    organization: "test",
                    perhapsExamMode: true,
                    title: "The Python Course",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.perhapsExamMode).to.be.true;
        });

        test("should succeed with version 0.9.0 data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    disabled: true,
                    exercises: [
                        { id: 1, name: "hello_world", passed: false },
                        { id: 2, name: "other_hello_world", passed: false },
                    ],
                    material_url: "mooc.fi",
                    name: "test-python-course",
                    newExercises: [2, 3, 4],
                    notifyAfter: 1234,
                    organization: "test",
                    perhapsExamMode: true,
                    title: "The Python Course",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.disabled).to.be.true;
            expect(migratedCourse?.materialUrl).to.be.equal("mooc.fi");
        });

        test("should succeed with version 1.0.0 data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    disabled: true,
                    exercises: [
                        {
                            id: 1,
                            deadline: null,
                            name: "hello_world",
                            passed: false,
                            softDeadline: null,
                        },
                        {
                            id: 2,
                            deadline: "20201214",
                            name: "other_hello_world",
                            passed: false,
                            softDeadline: "20201212",
                        },
                    ],
                    material_url: "mooc.fi",
                    name: "test-python-course",
                    newExercises: [2, 3, 4],
                    notifyAfter: 1234,
                    organization: "test",
                    perhapsExamMode: true,
                    title: "The Python Course",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.disabled).to.be.true;
            expect(migratedCourse?.materialUrl).to.be.equal("mooc.fi");
        });

        test("should succeed with version 2.0.0 data", async function () {
            const courses: LocalCourseDataV1[] = [
                {
                    id: 0,
                    availablePoints: 3,
                    awardedPoints: 0,
                    description: "Python Course",
                    disabled: true,
                    exercises: [
                        {
                            id: 1,
                            deadline: null,
                            name: "hello_world",
                            passed: false,
                            softDeadline: null,
                        },
                        {
                            id: 2,
                            deadline: "20201214",
                            name: "other_hello_world",
                            passed: false,
                            softDeadline: "20201212",
                        },
                    ],
                    materialUrl: "mooc.fi",
                    name: "test-python-course",
                    newExercises: [2, 3, 4],
                    notifyAfter: 1234,
                    organization: "test",
                    perhapsExamMode: true,
                    title: "The Python Course",
                },
            ];
            await memento.update(USER_DATA_KEY_V1, { courses });
            expect(migrateUserData(memento).data?.courses).to.be.deep.equal(courses);
        });
    });

    suite("with unstable data", function () {
        test("should fail if data is garbage", async function () {
            await memento.update(USER_DATA_KEY_V0, { batman: "Bruce Wayne" });
            expect(() => migrateUserData(memento)).to.throw(/missmatch/);
        });

        test("should set valid placeholders with minimal data", async function () {
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    description: "Python Course",
                    exercises: [],
                    name: "test-python-course",
                    organization: "test",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];
            expect(migratedCourse?.title).to.be.equal("test-python-course");
        });

        test("should find more exercise info from old exerciseData", async function () {
            await memento.update(UNSTABLE_EXERCISE_DATA_KEY, [
                { id: 1, deadline: null, name: "hello_world", softDeadline: null },
                {
                    id: 2,
                    deadline: "20201214",
                    name: "other_hello_world",
                    softDeadline: "20201212",
                },
            ]);
            const courses: LocalCourseDataV0[] = [
                {
                    id: 0,
                    description: "Python Course",
                    exercises: [
                        { id: 1, passed: false },
                        { id: 2, passed: false },
                    ],
                    name: "test-python-course",
                    organization: "test",
                },
            ];
            await memento.update(USER_DATA_KEY_V0, { courses });
            const migratedCourse = migrateUserData(memento).data?.courses[0];

            const exercise1 = migratedCourse?.exercises.find((x) => x.id === 1);
            expect(exercise1?.deadline).to.be.null;
            expect(exercise1?.name).to.be.equal("hello_world");
            expect(exercise1?.softDeadline).to.be.equal(null);

            const exercise2 = migratedCourse?.exercises.find((x) => x.id === 2);
            expect(exercise2?.deadline).to.be.equal("20201214");
            expect(exercise2?.name).to.be.equal("other_hello_world");
            expect(exercise2?.softDeadline).to.be.equal("20201212");
        });

        test("should successfully map unstable data with multiple courses", async function () {
            const courses: LocalCourseDataV0[] = [
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
            const migrated = migrateUserData(memento).data?.courses;
            expect(migrated?.length).to.be.equal(2);
            expect(migrated?.find((x) => x.id === 0)?.name).to.be.equal("test-python-course");
            expect(migrated?.find((x) => x.id === 1)?.name).to.be.equal("test-java-course");
        });
    });

    suite("with stable data", function () {
        test("should fail with garbage version 1 data", async function () {
            await memento.update(USER_DATA_KEY_V1, { batman: "Bruce Wayne" });
            expect(() => migrateUserData(memento)).to.throw(/missmatch/);
        });
    });
});
