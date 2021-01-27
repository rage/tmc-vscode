import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import { createIs } from "typescript-is";
import * as vscode from "vscode";

import TMC from "../api/tmc";
import { Logger } from "../utils";
import { incrementPercentageWrapper } from "../window";

import { MigratedData } from "./types";
import validateData from "./validateData";

const EXERCISE_DATA_KEY_V0 = "exerciseData";
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

function exerciseIsClosedV0(exerciseStatus?: ExerciseStatusV0, isOpen?: boolean): boolean {
    if (exerciseStatus === ExerciseStatusV0.CLOSED) {
        return true;
    } else if (isOpen === false) {
        return true;
    }

    return false;
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
): Promise<void> {
    interface ExtensionSettingsPartial {
        dataPath: string;
    }

    const dataPath = memento.get<ExtensionSettingsPartial>(UNSTABLE_EXTENSION_SETTINGS_KEY)
        ?.dataPath;
    const closedExercises: { [key: string]: string[] } = {};

    const exercisesToMigrate: Array<[LocalExerciseDataV0, string]> = [];
    for (const exercise of exerciseData) {
        const { id, course, isOpen, name, path, organization, status } = exercise;
        if (exerciseIsClosedV0(status, isOpen)) {
            if (closedExercises[course]) {
                closedExercises[course].push(name);
            } else {
                closedExercises[course] = [name];
            }
        }

        const pathResult = resolveExercisePathV0(id, name, course, organization, path, dataPath);
        if (pathResult.err) {
            Logger.error(`Have to discard exercise ${course}/${name}:`, pathResult.val);
            continue;
        }

        exercisesToMigrate.push([exercise, pathResult.val]);
    }

    if (exercisesToMigrate.length === 0) {
        return;
    }

    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "TestMyCode",
        },
        async (progress) => {
            const progress2 = incrementPercentageWrapper(progress);
            let atLeastOneSuccess = false;
            let index = 0;
            for (const [exercise, path] of exercisesToMigrate) {
                const { checksum, course, id, name } = exercise;
                const migrationResult = await tmc.migrateExercise(course, checksum, id, path, name);
                if (migrationResult.ok) {
                    atLeastOneSuccess = true;
                } else {
                    Logger.error(
                        `Migration failed for exercise ${course}/${name}:`,
                        migrationResult.val,
                    );
                }

                progress2.report({
                    percent: ++index / exercisesToMigrate.length,
                    message: "Data migration in progress, please wait...",
                });
            }

            return atLeastOneSuccess ? Ok.EMPTY : Err("Exercise migration failed.");
        },
    );

    if (result.err) {
        throw new Error("Exercise migration failed.");
    }

    const closeExercisesResult = await tmc.setSetting(
        "closed-exercises",
        JSON.stringify(closedExercises),
    );
    if (closeExercisesResult.err) {
        Logger.error("Failed to migrate status of closed exercises.", closeExercisesResult.val);
    }
}

export default async function migrateExerciseData(
    memento: vscode.Memento,
    tmc: TMC,
): Promise<MigratedData<undefined>> {
    const obsoleteKeys: string[] = [];

    const dataV0 = validateData(
        memento.get(EXERCISE_DATA_KEY_V0),
        createIs<LocalExerciseDataV0[]>(),
    );
    if (dataV0) {
        await exerciseDataFromV0toV1(dataV0, memento, tmc);
        obsoleteKeys.push(EXERCISE_DATA_KEY_V0);
    }

    return { data: undefined, obsoleteKeys };
}
