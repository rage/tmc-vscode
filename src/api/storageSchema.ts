export enum ExerciseStatus {
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
    status: ExerciseStatus;
}

export interface LocalExerciseDataV1 {
    id: number;
    name: string;
    course: string;
    path: string;
    status: ExerciseStatus;
}

export type LocalExerciseData = LocalExerciseDataV1;
