/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";
import { ActionContext, CourseExerciseDownloads } from "./types";
import pLimit from "p-limit";
import { askForItem, getCurrentExerciseData, showNotification } from "../utils";
import { getOldSubmissions } from "./user";
import { OldSubmission } from "../api/types";
import { dateToString, parseDate } from "../utils/dateDeadline";

/**
 * Downloads given exercises and opens them in TMC workspace.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    courseExerciseDownloads: CourseExerciseDownloads[],
    returnToCourse?: number,
): Promise<void> {
    const { tmc, ui } = actionContext;

    const exerciseStatus = new Map<
        number,
        {
            name: string;
            organizationSlug: string;
            downloaded: boolean;
            failed: boolean;
            error: string;
            status: string;
        }
    >();

    for (const ced of courseExerciseDownloads) {
        const courseDetails = await tmc.getCourseDetails(ced.courseId, false);
        if (courseDetails.ok) {
            courseDetails.val.course.exercises
                .filter((x) => ced.exerciseIds.includes(x.id))
                .forEach((x) =>
                    exerciseStatus.set(x.id, {
                        name: x.name,
                        organizationSlug: ced.organizationSlug,
                        downloaded: false,
                        failed: false,
                        error: "",
                        status: "In queue",
                    }),
                );
        } else {
            vscode.window.showErrorMessage(
                `Could not download exercises, course details not found: \
                ${courseDetails.val.name} - ${courseDetails.val.message}`,
            );
        }
    }

    const downloadCount = exerciseStatus.size;
    let successful = 0;
    let failed = 0;

    ui.webview.setContentFromTemplate("downloading-exercises", {
        returnToCourse,
        exercises: exerciseStatus.values(),
        failed,
        failedPct: Math.round((100 * failed) / downloadCount),
        remaining: downloadCount - successful - failed,
        successful,
        successfulPct: Math.round((100 * successful) / downloadCount),
        total: downloadCount,
    });

    const limit = pLimit(3);

    await Promise.all(
        Array.from(exerciseStatus.entries()).map<Promise<Result<string, Error>>>(([id, data]) =>
            limit(
                () =>
                    new Promise((resolve) => {
                        if (data) {
                            data.status = "Downloading";
                            exerciseStatus.set(id, data);
                            ui.webview.setContentFromTemplate("downloading-exercises", {
                                returnToCourse,
                                exercises: exerciseStatus.values(),
                                failed,
                                failedPct: Math.round((100 * failed) / downloadCount),
                                remaining: downloadCount - successful - failed,
                                successful,
                                successfulPct: Math.round((100 * successful) / downloadCount),
                                total: downloadCount,
                            });
                        }

                        tmc.downloadExercise(id, data.organizationSlug).then(
                            (res: Result<string, Error>) => {
                                if (data) {
                                    if (res.ok) {
                                        successful += 1;
                                        data.downloaded = true;
                                    } else {
                                        failed += 1;
                                        data.failed = true;
                                        data.error = res.val.message;
                                    }
                                    exerciseStatus.set(id, data);
                                    ui.webview.setContentFromTemplate("downloading-exercises", {
                                        returnToCourse,
                                        exercises: exerciseStatus.values(),
                                        failed,
                                        failedPct: Math.round((100 * failed) / downloadCount),
                                        remaining: downloadCount - successful - failed,
                                        successful,
                                        successfulPct: Math.round(
                                            (100 * successful) / downloadCount,
                                        ),
                                        total: downloadCount,
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
export async function checkForExerciseUpdates(actionContext: ActionContext): Promise<void> {
    const { tmc, userData, workspaceManager } = actionContext;

    const coursesToUpdate: CourseExerciseDownloads[] = [];
    let count = 0;
    for (const course of userData.getCourses()) {
        const organizationSlug = course.organization;

        const result = await tmc.getCourseDetails(course.id);
        if (result.err) {
            return;
        }

        const exerciseIds: number[] = [];
        result.val.course.exercises.forEach((exercise) => {
            const localExercise = workspaceManager.getExerciseDataById(exercise.id);
            if (localExercise.ok && localExercise.val.checksum !== exercise.checksum) {
                exerciseIds.push(exercise.id);
            }
        });

        if (exerciseIds.length > 0) {
            coursesToUpdate.push({ courseId: course.id, exerciseIds, organizationSlug });
            count += exerciseIds.length;
        }
    }

    if (count > 0) {
        showNotification(
            `Found updates for ${count} exercises. Do you wish to download them?`,
            ["Download", (): Promise<void> => downloadExercises(actionContext, coursesToUpdate)],
            ["Later", (): void => {}],
        );
    }
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

    showNotification(`Resetting exercise ${exerciseData.val.name}`);
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
    workspaceManager.openExercise(...ids);
}

/**
 * Closes given exercises, hiding them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function closeExercises(actionContext: ActionContext, ids: number[]): Promise<void> {
    const { workspaceManager } = actionContext;
    workspaceManager.closeExercise(...ids);
}

export async function downloadOldSubmissions(actionContext: ActionContext): Promise<void> {
    const { tmc, workspaceManager, userData } = actionContext;
    const exercise = getCurrentExerciseData(workspaceManager);
    if (exercise.err) {
        showNotification("Currently open exercise is not part of the TMC exercises");
        return;
    }
    const course = userData.getCourseByName(exercise.val.course);
    const response = await getOldSubmissions(actionContext);
    if (response.err) {
        showNotification(
            "Something went wrong while fetching old submissions: " + response.val.message,
        );
        return;
    }
    const submission = await askForItem<OldSubmission>(
        exercise.val.name + ": Select a submission",
        false,
        ...response.val.map(
            (a) =>
                [
                    dateToString(parseDate(a.processing_attempts_started_at)) +
                        "| " +
                        (a.all_tests_passed ? "Passed" : "Failed"),
                    a,
                ] as [string, OldSubmission],
        ),
    );

    if (submission?.id !== undefined) {
        const oldSub = await tmc.downloadOldExercise(
            submission.id,
            submission.exercise_name,
            exercise.val.course,
            course.organization,
            dateToString(parseDate(submission.processing_attempts_started_at)),
        );
        if (oldSub.ok) {
            showNotification(oldSub.val);
        } else {
            showNotification(
                "Something went wrong while downloading old submission for exercise: " + oldSub.val,
            );
        }
    }
}
