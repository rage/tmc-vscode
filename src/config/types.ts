export type LocalCourseData = {
    id: number;
    name: string;
    description: string;
    organization: string;
    exercises: Array<{
        id: number;
        passed: boolean;
    }>;
};

export type LocalExerciseData = {
    id: number;
    name: string;
    course: string;
    organization: string;
    path: string;
    checksum: string;
    isOpen: boolean;
    deadline: string | null;
};
