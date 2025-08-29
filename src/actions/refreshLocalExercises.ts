import { ExerciseStatus, WorkspaceExercise } from "../api/workspaceManager";
import { Logger } from "../utilities";
import { ActionContext } from "./types";
import { Err, Result } from "ts-results";
import { createIs } from "typia";
import * as vscode from "vscode";

/**
 * Asks for all local exercises from TMC-Langs and passes them to WorkspaceManager.
 */
export async function refreshLocalExercises(
    actionContext: ActionContext,
): Promise<Result<void, Error>> {
    const { tmc, userData, workspaceManager } = actionContext;
    if (!(tmc.ok && userData.ok && workspaceManager.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Refreshing local exercises");

    const workspaceExercises: WorkspaceExercise[] = [];
    for (const course of userData.val.getCourses()) {
        const exercisesResult = await tmc.val.listLocalCourseExercises(course.name);
        if (exercisesResult.err) {
            Logger.warn(
                `Failed to get exercises for course: ${JSON.stringify(course, null, 2)}`,
                exercisesResult.val,
            );
            continue;
        }

        const closedExercisesResult = (
            await tmc.val.getSetting(
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

    return workspaceManager.val.setExercises(workspaceExercises);
}
