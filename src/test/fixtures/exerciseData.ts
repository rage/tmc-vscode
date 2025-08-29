import { v0 } from "../../storage/data";

const v0_1_0 = (root: string): v0.LocalExerciseData[] => {
    return [
        {
            id: 1,
            checksum: "abc123",
            course: "test-python-course",
            deadline: "20201214",
            name: "hello_world",
            organization: "test",
            path: root + "/TMC workspace/Exercises/test/test-python-course/hello_world",
            isOpen: true,
        },
        {
            id: 2,
            checksum: "def456",
            course: "test-python-course",
            deadline: "20201214",
            name: "other_world",
            organization: "test",
            path: root + "/TMC workspace/closed-exercises/2",
            isOpen: false,
        },
    ];
};

const v0_2_0 = (root: string): v0.LocalExerciseData[] => [
    {
        id: 1,
        checksum: "abc123",
        course: "test-python-course",
        deadline: "20201214",
        name: "hello_world",
        organization: "test",
        path: root + "/TMC workspace/Exercises/test/test-python-course/hello_world",
        softDeadline: "20201212",
        status: v0.ExerciseStatus.OPEN,
        updateAvailable: true,
    },
    {
        id: 2,
        checksum: "def456",
        course: "test-python-course",
        deadline: "20201214",
        name: "other_world",
        organization: "test",
        path: root + "/TMC workspace/closed-exercises/2",
        softDeadline: "20201212",
        status: v0.ExerciseStatus.CLOSED,
        updateAvailable: false,
    },
];

const v0_3_0: v0.LocalExerciseData[] = [
    {
        id: 1,
        checksum: "abc123",
        course: "test-python-course",
        deadline: "20201214",
        name: "hello_world",
        organization: "test",
        softDeadline: "20201212",
        status: v0.ExerciseStatus.OPEN,
        updateAvailable: true,
    },
    {
        id: 2,
        checksum: "def456",
        course: "test-python-course",
        deadline: "20201214",
        name: "other_world",
        organization: "test",
        softDeadline: "20201212",
        status: v0.ExerciseStatus.CLOSED,
        updateAvailable: false,
    },
];

const v0_9_0: v0.LocalExerciseData[] = [
    {
        id: 1,
        checksum: "abc123",
        course: "test-python-course",
        deadline: "20201214",
        name: "hello_world",
        organization: "test",
        softDeadline: "20201212",
        status: v0.ExerciseStatus.OPEN,
    },
    {
        id: 2,
        checksum: "def456",
        course: "test-python-course",
        deadline: "20201214",
        name: "other_world",
        organization: "test",
        softDeadline: "20201212",
        status: v0.ExerciseStatus.CLOSED,
    },
];

export { v0_1_0, v0_2_0, v0_3_0, v0_9_0 };
