import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import { createIs } from "typia";
import * as vscode from "vscode";

import Dialog from "../../api/dialog";
import TMC from "../../api/tmc";
import { Logger } from "../../utilities";

import * as data from "../data";
import validateData, { MigratedData } from ".";

export function v0_exerciseIsClosed(
    exerciseStatus?: data.v0.ExerciseStatus,
    isOpen?: boolean,
): boolean {
    if (exerciseStatus === data.v0.ExerciseStatus.CLOSED) {
        return true;
    } else if (isOpen === false) {
        return true;
    }

    return false;
}

export function v0_resolveExercisePath(
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
            Logger.debug("Invalid candidate", candidate);
        }
    }

    return Err(
        new Error(
            `Failed to resolve new exercise path for exercise ${name} with paths ${candidates.join(
                ", ",
            )}`,
        ),
    );
}

export async function v1_from_v0_migrate(
    exerciseData: data.v0.LocalExerciseData[],
    memento: vscode.Memento,
    dialog: Dialog,
    tmc: TMC,
): Promise<void> {
    interface ExtensionSettingsPartial {
        dataPath: string;
    }

    const dataPath = memento.get<ExtensionSettingsPartial>(
        data.v0.EXTENSION_SETTINGS_KEY,
    )?.dataPath;
    const closedExercises: { [key: string]: string[] } = {};

    const exercisesToMigrate: Array<[data.v0.LocalExerciseData, string]> = [];
    for (const exercise of exerciseData) {
        const { id, course, isOpen, name, path, organization, status } = exercise;
        if (v0_exerciseIsClosed(status, isOpen)) {
            if (closedExercises[course]) {
                closedExercises[course].push(name);
            } else {
                closedExercises[course] = [name];
            }
        }

        const pathResult = v0_resolveExercisePath(id, name, course, organization, path, dataPath);
        if (pathResult.err) {
            Logger.error(`Have to discard exercise ${course}/${name}:`, pathResult.val);
            continue;
        }

        exercisesToMigrate.push([exercise, pathResult.val]);
    }

    if (exercisesToMigrate.length === 0) {
        return;
    }

    const message =
        "Migrating exercises on disk for extension version 2. Please do not close the editor...";
    const result = await dialog.progressNotification(message, async (progress) => {
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

            progress.report({
                percent: ++index / exercisesToMigrate.length,
                message,
            });
        }

        return atLeastOneSuccess ? Ok.EMPTY : Err("Exercise migration failed.");
    });

    if (result.err) {
        throw new Error("Exercise migration failed.");
    }

    for (const key of Object.keys(closedExercises)) {
        const closeExercisesResult = await tmc.setSetting(
            `closed-exercises-for:${key}`,
            closedExercises[key],
        );
        if (closeExercisesResult.err) {
            Logger.error("Failed to migrate status of closed exercises.", closeExercisesResult.val);
        }
    }
}

export default async function migrateExerciseDataToLatest(
    memento: vscode.Memento,
    dialog: Dialog,
    tmc: TMC,
): Promise<MigratedData<undefined>> {
    const obsoleteKeys: string[] = [];

    // migrate v0 data if there is any
    const dataV0 = validateData(
        memento.get(data.v0.EXERCISE_DATA_KEY),
        createIs<data.v0.LocalExerciseData[]>(),
    );
    if (dataV0) {
        await v1_from_v0_migrate(dataV0, memento, dialog, tmc);
        obsoleteKeys.push(data.v0.EXERCISE_DATA_KEY);
    }

    return { data: undefined, obsoleteKeys };
}
