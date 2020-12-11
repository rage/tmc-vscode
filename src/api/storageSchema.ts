// Volatile enum usage
enum ExerciseStatusV0 {
    OPEN,
    CLOSED,
    MISSING,
}

export interface LocalExerciseDataV0 {
    id: number;
    name: string;
    course: string;
    organization: string;
    checksum: string;
    status: ExerciseStatusV0;
}

export enum ExerciseStatus {
    OPEN = "open",
    CLOSED = "closed",
    MISSING = "missing",
}

export interface LocalExerciseDataV1 {
    id: number;
    name: string;
    course: string;
    path: string;
    status: ExerciseStatus;
}
