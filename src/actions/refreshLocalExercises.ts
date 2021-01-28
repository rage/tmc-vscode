import { Result } from "ts-results";
import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { ExerciseStatus, WorkspaceExercise } from "../api/workspaceManager";
import { Logger } from "../utils";

import { ActionContext } from "./types";

/**
 * Asks for all local exercises from TMC-Langs and passes them to WorkspaceManager.
 */
export async function refreshLocalExercises(
    actionContext: ActionContext,
): Promise<Result<void, Error>> {
    const { tmc, userData, workspaceManager } = actionContext;

    const workspaceExercises: WorkspaceExercise[] = [];
    for (const course of userData.getCourses()) {
        const exercisesResult = await tmc.listLocalCourseExercises(course.name);
        if (exercisesResult.err) {
            Logger.warn(`Failed to get exercises for course: ${course}`, exercisesResult.val);
            continue;
        }

        const closedExercisesResult = (
            await tmc.getSettingObject(
                `closed-exercises-for:${course.name}`,
                createIs<string[] | null>(),
            )
        ).mapErr((e) => {
            Logger.warn("Failed to determine closed status for exercises, defaulting to open.", e);
            return [];
        });

        const closedExercises = new Set(closedExercisesResult.val ?? []);
        workspaceExercises.push(
            ...exercisesResult.val.map<WorkspaceExercise>((x) => ({
                courseSlug: course.name,
                exerciseSlug: x["exercise-slug"],
                status: closedExercises.has(x["exercise-slug"])
                    ? ExerciseStatus.Closed
                    : ExerciseStatus.Open,
                uri: vscode.Uri.file(x["exercise-path"]),
            })),
        );
    }

    return workspaceManager.setExercises(workspaceExercises);
}
