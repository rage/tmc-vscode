import { Err, Result } from "ts-results";
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
    const { langs, userData, workspaceManager } = actionContext;
    if (!(langs.ok && userData.ok && workspaceManager.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Refreshing local exercises");

    const workspaceExercises: WorkspaceExercise[] = [];
    for (const course of userData.val.getCourses()) {
        switch (course.kind) {
            case "tmc": {
                const exercisesResult = await langs.val.listLocalCourseExercises(
                    "tmc",
                    course.data.name,
                );
                if (exercisesResult.err) {
                    Logger.warn(
                        `Failed to get exercises for course: ${JSON.stringify(course, null, 2)}`,
                        exercisesResult.val,
                    );
                    continue;
                }

                const closedExercisesResult = (
                    await langs.val.getSetting(
                        `closed-exercises-for:${course.data.name}`,
                        createIs<string[] | null>(),
                    )
                ).mapErr((e) => {
                    Logger.warn(
                        "Failed to determine closed status for exercises, defaulting to open.",
                        e,
                    );
                    return [];
                });

                const closedExercises = new Set(closedExercisesResult.val ?? []);
                workspaceExercises.push(
                    ...exercisesResult.val.map<WorkspaceExercise>((x) => ({
                        backend: "tmc",
                        courseSlug: course.data.name,
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
                const exercisesResult = await langs.val.listLocalCourseExercises(
                    "mooc",
                    course.data.courseName,
                );
                if (exercisesResult.err) {
                    Logger.warn(
                        `Failed to get exercises for course: ${JSON.stringify(course, null, 2)}`,
                        exercisesResult.val,
                    );
                    continue;
                }

                const closedExercisesResult = (
                    await langs.val.getSetting(
                        `closed-exercises-for:${course.data.courseName}`,
                        createIs<string[] | null>(),
                    )
                ).mapErr((e) => {
                    Logger.warn(
                        "Failed to determine closed status for exercises, defaulting to open.",
                        e,
                    );
                    return [];
                });

                const closedExercises = new Set(closedExercisesResult.val ?? []);
                workspaceExercises.push(
                    ...exercisesResult.val.map<WorkspaceExercise>((x) => ({
                        backend: "mooc",
                        courseSlug: course.data.courseName,
                        exerciseSlug: x["exercise-slug"],
                        status: closedExercises.has(x["exercise-slug"])
                            ? ExerciseStatus.Closed
                            : ExerciseStatus.Open,
                        uri: vscode.Uri.file(x["exercise-path"]),
                    })),
                );
                break;
            }
            default: {
                assertUnreachable(course);
            }
        }
    }

    return workspaceManager.val.setExercises(workspaceExercises);
}
