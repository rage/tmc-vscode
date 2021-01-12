import { nth } from "lodash";
import * as path from "path";
import { Result } from "ts-results";
import * as vscode from "vscode";

import { LocalExercise } from "../api/langsSchema";
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

    const langsExercises: LocalExercise[] = [];
    for (const course of userData.getCourses()) {
        const exercisesResult = await tmc.listLocalCourseExercises(course.name);
        if (exercisesResult.ok) {
            langsExercises.push(...exercisesResult.unwrapOr([]));
        } else {
            Logger.warn(`Failed to get exercises for course: ${course}`, exercisesResult.val);
        }
    }

    const workspaceExercises = langsExercises.map<WorkspaceExercise>((x) => {
        const exercisePath = x["exercise-path"];
        const exerciseSlug = x["exercise-slug"];
        return {
            courseSlug: nth(exercisePath.split(path.sep), -2) ?? "null",
            exerciseSlug,
            status: ExerciseStatus.Open,
            uri: vscode.Uri.file(exercisePath),
        };
    });

    const updateResult = workspaceManager.setExercises(workspaceExercises);
    return updateResult;
}
