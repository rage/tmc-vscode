import * as path from "path";
import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { MigratedData } from "./types";
import validateData from "./validateData";

const EXERCISE_DATA_KEY_V0 = "exerciseData";
const EXERCISE_DATA_KEY_V1 = "exercise-data-v1";

export enum ExerciseStatusV0 {
    OPEN = 0,
    CLOSED = 1,
    MISSING = 2,
}

export enum ExerciseStatusV1 {
    OPEN = "open",
    CLOSED = "closed",
    MISSING = "missing",
}

export interface LocalExerciseDataV0 {
    id: number;
    checksum: string;
    name: string;
    course: string;
    deadline?: string | null;
    isOpen?: boolean;
    organization: string;
    path?: string;
    softDeadline?: string | null;
    status?: ExerciseStatusV0;
    updateAvailable?: boolean;
}

export interface LocalExerciseDataV1 {
    id: number;
    checksum: string;
    name: string;
    course: string;
    path: string;
    organization: string;
    status: ExerciseStatusV1;
}

function resolveExerciseStatusFromV0toV1(
    exerciseStatus?: ExerciseStatusV0,
    isOpen?: boolean,
): ExerciseStatusV1 {
    switch (exerciseStatus) {
        case ExerciseStatusV0.CLOSED:
            return ExerciseStatusV1.CLOSED;
        case ExerciseStatusV0.MISSING:
            return ExerciseStatusV1.MISSING;
        case ExerciseStatusV0.OPEN:
            return ExerciseStatusV1.OPEN;
    }

    return isOpen ? ExerciseStatusV1.OPEN : ExerciseStatusV1.MISSING;
}

function exerciseDataFromV0toV1(
    exerciseData: LocalExerciseDataV0[],
    workspaceDirectory: vscode.Uri,
): LocalExerciseDataV1[] {
    return exerciseData.map((x) => ({
        id: x.id,
        checksum: x.checksum,
        course: x.course,
        name: x.name,
        organization: x.organization,
        path: x.path ?? path.join(workspaceDirectory.fsPath, x.organization, x.course, x.name),
        status: resolveExerciseStatusFromV0toV1(x.status, x.isOpen),
    }));
}

export default function migrateExerciseData(
    memento: vscode.Memento,
    workspaceDirectory: vscode.Uri,
): MigratedData<LocalExerciseDataV1[]> {
    const keys: string[] = [EXERCISE_DATA_KEY_V0];
    const dataV0 = validateData(
        memento.get(EXERCISE_DATA_KEY_V0),
        createIs<LocalExerciseDataV0[]>(),
    );

    keys.push(EXERCISE_DATA_KEY_V1);
    const dataV1 = dataV0
        ? exerciseDataFromV0toV1(dataV0, workspaceDirectory)
        : validateData(memento.get(EXERCISE_DATA_KEY_V1), createIs<LocalExerciseDataV1[]>());

    return { data: dataV1, keys };
}
