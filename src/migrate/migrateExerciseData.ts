import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import { createIs } from "typescript-is";
import * as vscode from "vscode";

import TMC from "../api/tmc";
import { Logger } from "../utils";

import validateData from "./validateData";

const EXERCISE_DATA_KEY_V0 = "exerciseData";
const EXERCISE_DATA_KEY_V1 = "exercise-data-v1";
const UNSTABLE_EXTENSION_SETTINGS_KEY = "extensionSettings";

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function resolveExercisePathV0(
    id: number,
    name: string,
    course: string,
    organization: string,
    exercisePath?: string,
    dataPath?: string,
): Result<string, Error> {
    const workspacePath = dataPath && path.join(dataPath, "TMC workspace", "Exercises");
    const candidates = [
        exercisePath,
        workspacePath && path.join(workspacePath, organization, course, name),
        dataPath && path.join(dataPath, "TMC workspace", "closed-exercises", id.toString()),
    ];
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return Ok(candidate);
        } else {
            Logger.debug(candidate);
        }
    }

    return Err(
        new Error(
            `Failed to resolve new exercise path for exercise ${name} with paths ${candidates}`,
        ),
    );
}

async function exerciseDataFromV0toV1(
    exerciseData: LocalExerciseDataV0[],
    memento: vscode.Memento,
    tmc: TMC,
): Promise<Result<void, Error>> {
    interface ExtensionSettingsPartial {
        dataPath: string;
    }

    const dataPath = memento.get<ExtensionSettingsPartial>(UNSTABLE_EXTENSION_SETTINGS_KEY)
        ?.dataPath;
    for (const exercise of exerciseData) {
        const { id, checksum, course, name, path, organization } = exercise;
        const pathResult = resolveExercisePathV0(id, name, course, organization, path, dataPath);
        if (pathResult.err) {
            return pathResult;
        }

        const migrationResult = await tmc.migrateExercise(
            course,
            checksum,
            id,
            pathResult.val,
            name,
        );
        if (migrationResult.err) {
            return migrationResult;
        }
    }

    return Ok.EMPTY;
}

export default async function migrateExerciseData(
    memento: vscode.Memento,
    tmc: TMC,
): Promise<Result<void, Error>> {
    const keys: string[] = [EXERCISE_DATA_KEY_V0];
    const dataV0 = validateData(
        memento.get(EXERCISE_DATA_KEY_V0),
        createIs<LocalExerciseDataV0[]>(),
    );

    if (!dataV0) {
        return Ok.EMPTY;
    }

    keys.push(EXERCISE_DATA_KEY_V1);
    return exerciseDataFromV0toV1(dataV0, memento, tmc);
}
