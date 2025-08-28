import { v0, v1, v2 } from "../../storage/data";

export const userDataExerciseHelloWorld: v2.LocalCourseExercise = {
    id: 1,
    availablePoints: 1,
    awardedPoints: 0,
    deadline: null,
    name: "hello_world",
    passed: false,
    softDeadline: null,
};

// -------------------------------------------------------------------------------------------------
// Previous version snapshots
// -------------------------------------------------------------------------------------------------

interface UserDataV0 {
    courses: v0.LocalCourseData[];
}

interface UserDataV1 {
    courses: v1.LocalCourseData[];
}

export const v0_1_0: UserDataV0 = {
    courses: [
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
    ],
};

export const v0_2_0: UserDataV0 = {
    courses: [
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
    ],
};

export const v0_3_0: UserDataV0 = {
    courses: [
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
    ],
};

export const v0_4_0: UserDataV0 = {
    courses: [
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
    ],
};

export const v0_6_0: UserDataV0 = {
    courses: [
        {
            id: 0,
            availablePoints: 3,
            awardedPoints: 0,
            description: "Python Course",
            exercises: [
                { id: 1, name: "hello_world", passed: false },
                { id: 2, name: "other_world", passed: false },
            ],
            name: "test-python-course",
            newExercises: [2, 3, 4],
            notifyAfter: 1234,
            organization: "test",
            title: "The Python Course",
        },
    ],
};

export const v0_8_0: UserDataV0 = {
    courses: [
        {
            id: 0,
            availablePoints: 3,
            awardedPoints: 0,
            description: "Python Course",
            exercises: [
                { id: 1, name: "hello_world", passed: false },
                { id: 2, name: "other_world", passed: false },
            ],
            name: "test-python-course",
            newExercises: [2, 3, 4],
            notifyAfter: 1234,
            organization: "test",
            perhapsExamMode: true,
            title: "The Python Course",
        },
    ],
};

export const v0_9_0: UserDataV0 = {
    courses: [
        {
            id: 0,
            availablePoints: 3,
            awardedPoints: 0,
            description: "Python Course",
            disabled: true,
            exercises: [
                { id: 1, name: "hello_world", passed: false },
                { id: 2, name: "other_world", passed: false },
            ],
            material_url: "mooc.fi",
            name: "test-python-course",
            newExercises: [2, 3, 4],
            notifyAfter: 1234,
            organization: "test",
            perhapsExamMode: true,
            title: "The Python Course",
        },
    ],
};

export const v1_0_0: UserDataV0 = {
    courses: [
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
                    name: "other_world",
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
    ],
};

export const v2_0_0: UserDataV1 = {
    courses: [
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
                    name: "other_world",
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
    ],
};

export const v2_1_0: v2.UserData = {
    courses: [
        {
            id: 0,
            availablePoints: 3,
            awardedPoints: 0,
            description: "Python Course",
            disabled: true,
            exercises: [
                {
                    id: 1,
                    availablePoints: 1,
                    awardedPoints: 0,
                    deadline: null,
                    name: "hello_world",
                    passed: false,
                    softDeadline: null,
                },
                {
                    id: 2,
                    availablePoints: 1,
                    awardedPoints: 0,
                    deadline: "20201214",
                    name: "other_world",
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
    ],
};
