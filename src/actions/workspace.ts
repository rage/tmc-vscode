/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import { Err, Ok, Result } from "ts-results";
import { ActionContext, CourseExerciseDownloads } from "./types";
import * as pLimit from "p-limit";
import { askForConfirmation, askForItem, showError, showNotification } from "../utils";
import { getOldSubmissions } from "./user";
import { OldSubmission } from "../api/types";
import { dateToString, parseDate } from "../utils/dateDeadline";
import { NOTIFICATION_DELAY } from "../config/constants";

/**
 * Downloads given exercises and opens them in TMC workspace.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    courseExerciseDownloads: CourseExerciseDownloads[],
    returnToCourse?: number,
): Promise<void> {
    const { tmc, ui, logger } = actionContext;

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
        const courseDetails = await tmc.getCourseDetails(ced.courseId);
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
            const message = `Could not download exercises, course details not found: ${courseDetails.val.name} - ${courseDetails.val.message}`;
            logger.log(message);
            showError(message);
        }
    }

    const downloadCount = exerciseStatus.size;
    let successful = 0;
    let failed = 0;

    ui.webview.setContentFromTemplate({
        templateName: "downloading-exercises",
        returnToCourse,
        exercises: Array.from(exerciseStatus.values()),
        failed,
        failedPct: Math.round((100 * failed) / downloadCount),
        remaining: downloadCount - successful - failed,
        successful,
        successfulPct: Math.round((100 * successful) / downloadCount),
        total: downloadCount,
    });

    const limit = pLimit(3);

    await Promise.all(
        Array.from(exerciseStatus.entries()).map<Promise<Result<void, Error>>>(([id, data]) =>
            limit(
                () =>
                    new Promise((resolve) => {
                        if (data) {
                            data.status = "Downloading";
                            exerciseStatus.set(id, data);
                            ui.webview.setContentFromTemplate({
                                templateName: "downloading-exercises",
                                returnToCourse,
                                exercises: Array.from(exerciseStatus.values()),
                                failed,
                                failedPct: Math.round((100 * failed) / downloadCount),
                                remaining: downloadCount - successful - failed,
                                successful,
                                successfulPct: Math.round((100 * successful) / downloadCount),
                                total: downloadCount,
                            });
                        }

                        tmc.downloadExercise(id, data.organizationSlug).then(
                            (res: Result<void, Error>) => {
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
                                    ui.webview.setContentFromTemplate({
                                        templateName: "downloading-exercises",
                                        returnToCourse,
                                        exercises: Array.from(exerciseStatus.values()),
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
 * @param courseId If given, check only updates for that course.
 */
export async function checkForExerciseUpdates(
    actionContext: ActionContext,
    courseId?: number,
): Promise<void> {
    const { tmc, userData, workspaceManager, logger } = actionContext;

    const coursesToUpdate: Map<number, CourseExerciseDownloads> = new Map();
    let count = 0;
    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    const filteredCourses = courses.filter((c) => c.notifyAfter <= Date.now());
    logger.log(`Checking for exercise updates for courses ${filteredCourses.map((c) => c.name)}`);
    for (const course of filteredCourses) {
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
            coursesToUpdate.set(course.id, { courseId: course.id, exerciseIds, organizationSlug });
            count += exerciseIds.length;
        }
    }

    if (count > 0) {
        showNotification(
            `Found updates for ${count} exercises. Do you wish to download them?`,
            [
                "Download",
                (): Promise<void> =>
                    downloadExercises(actionContext, Array.from(coursesToUpdate.values())),
            ],
            [
                "Remind me later",
                (): void => {
                    coursesToUpdate.forEach((course) =>
                        userData.setNotifyDate(course.courseId, Date.now() + NOTIFICATION_DELAY),
                    );
                },
            ],
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
    const { ui, tmc, workspaceManager, logger } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(id);

    if (exerciseData.err) {
        const message = "The data for this exercise seems to be missing";

        showError(message);
        return new Err(exerciseData.val);
    }

    const saveOrNo = await askForConfirmation(
        "Do you want to save the current state of the exercise by submitting it to TMC Server?",
        true,
    );

    if (saveOrNo) {
        const submitResult = await tmc.submitExercise(id);
        if (submitResult.err) {
            const message = `Reset canceled, failed to submit exercise: ${submitResult.val.name} - ${submitResult.val.message}`;
            logger.error(message);
            showError(message);
            ui.setStatusBar(
                `Something went wrong while resetting exercise ${exerciseData.val.name}`,
                10000,
            );
            return new Err(submitResult.val);
        }
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
export async function openExercises(
    ids: number[],
    actionContext: ActionContext,
): Promise<Result<void, Error>> {
    const { workspaceManager, logger } = actionContext;

    const result = workspaceManager.openExercise(...ids);
    const errors = result.filter((file) => file.err);

    if (errors.length !== 0) {
        errors.forEach((e) =>
            logger.error("Error when opening file", e.mapErr((err) => err.message).val),
        );
        return new Err(new Error("Something went wrong while opening exercises."));
    }
    return Ok.EMPTY;
}

/**
 * Closes given exercises, hiding them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function closeExercises(
    actionContext: ActionContext,
    ids: number[],
): Promise<Result<void, Error>> {
    const { workspaceManager, logger } = actionContext;

    const result = workspaceManager.closeExercise(...ids);
    const errors = result.filter((file) => file.err);

    if (errors.length !== 0) {
        errors.forEach((e) =>
            logger.error("Error when closing file", e.mapErr((err) => err.message).val),
        );
        return new Err(new Error("Something went wrong while closing exercises."));
    }
    return Ok.EMPTY;
}

/**
 * Downloads an oldsubmission of a currently open exercise and submits current code to server if user wants it
 * @param exerciseId exercise which older submission will be downloaded
 * @param actionContext
 */

export async function downloadOldSubmissions(
    exerciseId: number,
    actionContext: ActionContext,
): Promise<void> {
    const { tmc, workspaceManager, logger } = actionContext;
    const exercise = workspaceManager.getExerciseDataById(exerciseId);
    if (exercise.err) {
        logger.error("Exercise data missing");
        showError("Exercise data missing");
        return;
    }
    const response = await getOldSubmissions(actionContext);
    if (response.err) {
        const message = `Something went wrong while fetching old submissions: ${response.val.message}`;
        logger.error(message);
        showError(message);
        return;
    }
    if (response.val.length === 0) {
        showNotification("No previous submissions found for this exercise.");
        return;
    }

    const submission = await askForItem(
        exercise.val.name + ": Select a submission",
        false,
        ...response.val.map<[string, OldSubmission]>((a) => [
            dateToString(parseDate(a.processing_attempts_started_at)) +
                "| " +
                (a.all_tests_passed ? "Passed" : "Not passed"),
            a,
        ]),
    );

    if (submission === undefined) {
        return;
    }

    const oldSub = await tmc.downloadOldExercise(actionContext, exercise.val.id, submission.id);
    if (oldSub.err) {
        const message = `Something went wrong while downloading old submission for exercise: ${oldSub.val}`;
        logger.error(message);
        showError(message);
        return;
    }
    showNotification(oldSub.val);
}
