import { nth } from "lodash";
import * as path from "path";
import { Result } from "ts-results";
import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { LocalExercise } from "../api/langsSchema";
import { ExerciseStatus, WorkspaceExercise } from "../api/workspaceManager";
import { Logger } from "../utils";

import { ActionContext, CourseClosedExercises } from "./types";

/**
 * Asks for all local exercises from TMC-Langs and passes them to WorkspaceManager.
 */
export async function refreshLocalExercises(
    actionContext: ActionContext,
): Promise<Result<void, Error>> {
    const { tmc, userData, workspaceManager } = actionContext;

    const langsExercises: LocalExercise[] = [];
    for (const course of userData.getCourses()) {
        const exercisesResult = await tmc.listLocalCourseExercises(course.name);
        if (exercisesResult.ok) {
            langsExercises.push(...exercisesResult.unwrapOr([]));
        } else {
            Logger.warn(`Failed to get exercises for course: ${course}`, exercisesResult.val);
        }
    }

    const closedExercisesResult = (
        await tmc.getSettingObject("closed-exercises", createIs<CourseClosedExercises[]>())
    ).mapErr((e) => {
        Logger.warn("Failed to determine closed status for exercises, defaulting to open.", e);
        return [];
    });
    const closedExercises = new Map(
        (closedExercisesResult.val ?? []).map((x) => [x["course-slug"], new Set(x.exercises)]),
    );
    const workspaceExercises = langsExercises.map<WorkspaceExercise>((x) => {
        const exercisePath = x["exercise-path"];
        const exerciseSlug = x["exercise-slug"];
        const courseSlug = nth(exercisePath.split(path.sep), -2) ?? "null";
        const isClosed = closedExercises.get(courseSlug)?.has(exerciseSlug);
        return {
            courseSlug,
            exerciseSlug,
            status: isClosed ? ExerciseStatus.Closed : ExerciseStatus.Open,
            uri: vscode.Uri.file(exercisePath),
        };
    });

    const updateResult = workspaceManager.setExercises(workspaceExercises);
    return updateResult;
}
