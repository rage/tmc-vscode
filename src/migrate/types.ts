export interface MigratedData<T> {
    data: T | undefined;
    keys: string[];
}

enum ExerciseStatusV0 {
    OPEN = 0,
    CLOSED = 1,
    MISSING = 2,
}

export interface UnstableLocalExerciseData {
    id: number;
    name: string;
    course: string;
    organization: string;
    checksum: string;
    deadline?: string | null;
    isOpen?: boolean;
    path?: string;
    softDeadline?: string | null;
    status?: ExerciseStatusV0;
    updateAvailable?: boolean;
}

export interface UnstableLocalCourseExercise {
    id: number;
    passed: boolean;
    name?: string;
    deadline?: string | null;
    softDeadline?: string | null;
}
