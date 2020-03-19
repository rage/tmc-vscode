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
    status: ExerciseStatus;
    deadline: string | null;
    softDeadline: string | null;
};

export enum ExerciseStatus {
    OPEN,
    CLOSED,
    MISSING,
}
