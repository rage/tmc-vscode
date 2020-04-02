/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";
import { ActionContext } from "./types";
import pLimit from "p-limit";

/**
 * Downloads given exercises and opens them in TMC workspace.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    ids: number[],
    organizationSlug: string,
    courseId: number,
): Promise<void> {
    const { tmc, ui } = actionContext;

    const courseDetails = await tmc.getCourseDetails(courseId, false);
    if (courseDetails.err) {
        vscode.window.showErrorMessage(`Could not download exercises, course details not found: \
                                        ${courseDetails.val.name} - ${courseDetails.val.message}`);
        return;
    }

    const exerciseStatus = new Map<
        number,
        { name: string; downloaded: boolean; failed: boolean; error: string; status: string }
    >(
        courseDetails.val.course.exercises
            .filter((x) => ids.includes(x.id))
            .map((x) => [
                x.id,
                { name: x.name, downloaded: false, failed: false, error: "", status: "In queue" },
            ]),
    );

    let successful = 0;
    let failed = 0;

    ui.webview.setContentFromTemplate("downloading-exercises", {
        courseId,
        exercises: exerciseStatus.values(),
        failed,
        failedPct: Math.round((100 * failed) / ids.length),
        remaining: ids.length - successful - failed,
        successful,
        successfulPct: Math.round((100 * successful) / ids.length),
        total: ids.length,
    });

    const limit = pLimit(3);

    await Promise.all(
        ids.map<Promise<Result<string, Error>>>((x) =>
            limit(
                () =>
                    new Promise((resolve) => {
                        const d = exerciseStatus.get(x);
                        if (d) {
                            d.status = "Downloading";
                            exerciseStatus.set(x, d);
                            ui.webview.setContentFromTemplate("downloading-exercises", {
                                courseId,
                                exercises: exerciseStatus.values(),
                                failed,
                                failedPct: Math.round((100 * failed) / ids.length),
                                remaining: ids.length - successful - failed,
                                successful,
                                successfulPct: Math.round((100 * successful) / ids.length),
                                total: ids.length,
                            });
                        }

                        tmc.downloadExercise(x, organizationSlug).then(
                            (res: Result<string, Error>) => {
                                const d = exerciseStatus.get(x);
                                if (d) {
                                    if (res.ok) {
                                        successful += 1;
                                        d.downloaded = true;
                                    } else {
                                        failed += 1;
                                        d.failed = true;
                                        d.error = res.val.message;
                                    }
                                    exerciseStatus.set(x, d);
                                    ui.webview.setContentFromTemplate("downloading-exercises", {
                                        courseId,
                                        exercises: exerciseStatus.values(),
                                        failed,
                                        failedPct: Math.round((100 * failed) / ids.length),
                                        remaining: ids.length - successful - failed,
                                        successful,
                                        successfulPct: Math.round((100 * successful) / ids.length),
                                        total: ids.length,
                                    });
                                }
                                resolve(res);
                            },
                        );
                    }),
            ),
        ),
    );
}

/**
 * Checks all user's courses for exercise updates and download them.
 */
export async function updateExercises(actionContext: ActionContext): Promise<void> {
    const { tmc, userData, workspaceManager } = actionContext;

    userData.getCourses().forEach(async (course) => {
        const organizationSlug = course.organization;
        const result = await tmc.getCourseDetails(course.id);

        if (result.err) {
            return;
        }

        const updateIds: number[] = [];
        result.val.course.exercises.forEach((exercise) => {
            const localExercise = workspaceManager.getExerciseDataById(exercise.id);
            if (localExercise.ok && localExercise.val.checksum !== exercise.checksum) {
                updateIds.push(exercise.id);
            }
        });

        if (updateIds.length > 0) {
            console.log(`Updating exercises: ${updateIds}`);
            downloadExercises(actionContext, updateIds, organizationSlug, course.id);
        }
    });
}

/**
 * Sends given exercise to the server and resets it to initial state.
 * @param id ID of the exercise to reset
 */
export async function resetExercise(
    actionContext: ActionContext,
    id: number,
): Promise<Result<void, Error>> {
    const { ui, tmc, workspaceManager } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(id);

    if (exerciseData.err) {
        vscode.window.showErrorMessage("The data for this exercise seems to be missing");
        return new Err(exerciseData.val);
    }

    const submitResult = await tmc.submitExercise(id);
    if (submitResult.err) {
        vscode.window.showErrorMessage(`Reset canceled, failed to submit exercise: \
       ${submitResult.val.name} - ${submitResult.val.message}`);
        ui.setStatusBar(
            `Something went wrong while resetting exercise ${exerciseData.val.name}`,
            10000,
        );
        return new Err(submitResult.val);
    }

    vscode.window.showInformationMessage(`Resetting exercise ${exerciseData.val.name}`);
    ui.setStatusBar(`Resetting exercise ${exerciseData.val.name}`);

    const slug = exerciseData.val.organization;
    workspaceManager.deleteExercise(id);
    await tmc.downloadExercise(id, slug);
    ui.setStatusBar(`Exercise ${exerciseData.val.name} resetted successfully`, 10000);
    return Ok.EMPTY;
}

/**
 * Opens given exercises, showing them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function openExercises(ids: number[], actionContext: ActionContext): Promise<void> {
    const { workspaceManager } = actionContext;
    ids.forEach((id) => workspaceManager.openExercise(id));
}

/**
 * Closes given exercises, hiding them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function closeExercises(actionContext: ActionContext, ids: number[]): Promise<void> {
    const { workspaceManager } = actionContext;
    ids.forEach((id) => workspaceManager.closeExercise(id));
}
