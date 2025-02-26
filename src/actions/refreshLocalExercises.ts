import { Result } from "ts-results";
import { createIs } from "typia";
import * as vscode from "vscode";

import { ExerciseStatus, WorkspaceExercise } from "../api/workspaceManager";
import { assertUnreachable } from "../shared/shared";
import { Logger } from "../utilities";

import { ActionContext } from "./types";

/**
 * Asks for all local exercises from TMC-Langs and passes them to WorkspaceManager.
 */
export async function refreshLocalExercises(
    actionContext: ActionContext,
): Promise<Result<void, Error>> {
    const { tmc, userData, workspaceManager } = actionContext;
    Logger.info("Refreshing local exercises");

    const workspaceExercises: WorkspaceExercise[] = [];
    for (const course of userData.getCourses()) {
        switch (course.kind) {
            case "tmc": {
                const tmcCourse = course.data;
                const exercisesResult = await tmc.listLocalCourseExercises(tmcCourse.name);
                if (exercisesResult.err) {
                    Logger.warn(
                        `Failed to get exercises for course: ${JSON.stringify(course, null, 2)}`,
                        exercisesResult.val,
                    );
                    continue;
                }

                const closedExercisesResult = (
                    await tmc.getSetting(`closed-exercises-for:${tmcCourse.name}`, createIs<string[] | null>())
                ).mapErr((e) => {
                    Logger.warn("Failed to determine closed status for exercises, defaulting to open.", e);
                    return [];
                });

                const closedExercises = new Set(closedExercisesResult.val ?? []);
                workspaceExercises.push(
                    ...exercisesResult.val.map<WorkspaceExercise>((x) => ({
                        courseSlug: tmcCourse.name,
                        exerciseSlug: x["exercise-slug"],
                        status: closedExercises.has(x["exercise-slug"])
                            ? ExerciseStatus.Closed
                            : ExerciseStatus.Open,
                        uri: vscode.Uri.file(x["exercise-path"]),
                    })),
                );
                break;
            }
            case "mooc": {
                throw new Error("todo")
            }
            default: {
                assertUnreachable(course)
            }
        }

    }

    return workspaceManager.setExercises(workspaceExercises);
}
