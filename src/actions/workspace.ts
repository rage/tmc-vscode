/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import * as _ from "lodash";
import * as pLimit from "p-limit";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { OldSubmission } from "../api/types";
import { NOTIFICATION_DELAY } from "../config/constants";
import { ExerciseStatus } from "../config/types";
import { ExerciseStatus as TextStatus, WebviewMessage } from "../ui/types";
import { askForItem, showError, showNotification, showProgressNotification } from "../utils";
import { dateToString, parseDate } from "../utils/dateDeadline";

import { ActionContext, CourseExerciseDownloads } from "./types";
import { getOldSubmissions } from "./user";

const limit = pLimit(3);

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param courseExerciseDownloads An array of course-related data that is required for downloading.
 * @returns An array of successful downloads.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    courseExerciseDownloads: CourseExerciseDownloads[],
): Promise<number[]> {
    const { tmc, ui, logger } = actionContext;

    interface StatusChange {
        exerciseId: number;
        status: TextStatus;
    }

    const postChange = (...changes: StatusChange[]): void =>
        ui.webview.postMessage(
            ...changes.map<{ key: string; message: WebviewMessage }>(({ exerciseId, status }) => ({
                key: `exercise-${exerciseId}-status`,
                message: {
                    command: "exerciseStatusChange",
                    exerciseId,
                    status,
                },
            })),
        );

    type DownloadState = {
        id: number;
        name: string;
        organizationSlug: string;
    };

    const successful: DownloadState[] = [];
    const failed: DownloadState[] = [];

    const task = (
        process: vscode.Progress<{ downloadedPct: number; increment: number }>,
        state: DownloadState,
    ): Promise<void> =>
        new Promise<void>((resolve) => {
            tmc.downloadExercise(state.id, state.organizationSlug, (downloadedPct, increment) =>
                process.report({ downloadedPct, increment }),
            ).then((res: Result<void, Error>) => {
                postChange({ exerciseId: state.id, status: res.ok ? "closed" : "downloadFailed" });
                if (res.ok) {
                    successful.push(state);
                } else {
                    failed.push(state);
                    logger.error(
                        `Failed to download ${state.organizationSlug}/${state.name}`,
                        res.val.message,
                    );
                }
                resolve();
            });
        });

    postChange(
        ...courseExerciseDownloads
            .reduce<number[]>((collected, next) => collected.concat(next.exerciseIds), [])
            .map<StatusChange>((exerciseId) => ({ exerciseId, status: "downloading" })),
    );

    // TODO: Base this process on above reduction
    const exerciseStatuses = await Promise.all(
        courseExerciseDownloads.map(async (ced) => {
            const courseDetails = await tmc.getCourseDetails(ced.courseId);
            if (courseDetails.err) {
                logger.warn(
                    "Could not download exercises, course details not found: " +
                        `${courseDetails.val.name} - ${courseDetails.val.message}`,
                );
                return [];
            }
            return courseDetails.val.course.exercises
                .filter((x) => ced.exerciseIds.includes(x.id))
                .map<DownloadState>((x) => ({
                    id: x.id,
                    name: x.name,
                    organizationSlug: ced.organizationSlug,
                }));
        }),
    ).then((res) => res.reduce((collected, next) => collected.concat(next), []));

    logger.log(`Starting to download ${exerciseStatuses.length} exercises`);
    await showProgressNotification(
        `Downloading ${exerciseStatuses.length} exercises...`,
        ...exerciseStatuses.map(
            (state) => (
                p: vscode.Progress<{ downloadedPct: number; increment: number }>,
            ): Promise<void> => limit(() => task(p, state)),
        ),
    );

    if (failed.length > 0) {
        logger.error("Some exercises failed to download");
        showError("Some exercises failed to download, please try again later.", [
            "Details",
            (): void => logger.show(),
        ]);
    }

    return successful.map((x) => x.id);
}

interface UpdateCheckOptions {
    notify?: boolean;
    useCache?: boolean;
}

/**
 * Checks all user's courses for exercise updates and download them.
 * @param courseId If given, check only updates for that course.
 */
export async function checkForExerciseUpdates(
    actionContext: ActionContext,
    courseId?: number,
    updateCheckOptions?: UpdateCheckOptions,
): Promise<CourseExerciseDownloads[]> {
    const { tmc, userData, workspaceManager, logger } = actionContext;

    const coursesToUpdate: Map<number, CourseExerciseDownloads> = new Map();
    let count = 0;
    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    const filteredCourses = courses.filter((c) => c.notifyAfter <= Date.now() && !c.disabled);
    logger.log(`Checking for exercise updates for courses ${filteredCourses.map((c) => c.name)}`);
    for (const course of filteredCourses) {
        const organizationSlug = course.organization;

        const result = await tmc.getCourseDetails(course.id, updateCheckOptions?.useCache || false);
        if (result.err) {
            continue;
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

    if (count > 0 && updateCheckOptions?.notify !== false) {
        showNotification(
            `Found updates for ${count} exercises. Do you wish to download them?`,
            [
                "Download",
                async (): Promise<void> => {
                    const exerciseIds = Array.from(coursesToUpdate.values())
                        .map((x) => x.exerciseIds)
                        .reduce((acc, next) => acc.concat(next), []);
                    const openAfter = exerciseIds.filter(
                        (id) =>
                            workspaceManager.getExerciseDataById(id).mapErr(() => undefined).val
                                ?.status !== ExerciseStatus.CLOSED,
                    );
                    const successful = await downloadExercises(
                        actionContext,
                        Array.from(coursesToUpdate.values()),
                    );
                    openExercises(actionContext, _.intersection(openAfter, successful));
                },
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
    return Array.from(coursesToUpdate.values());
}

interface ResetOptions {
    /** Whether to submit current state, asks user if not defined. */
    submitCurrent?: boolean;
}

/**
 * Resets an exercise to its initial state. Optionally submits the exercise beforehand.
 *
 * @param id ID of the exercise to reset.
 * @param options Optional parameters for predetermine action behavior.
 */
export async function resetExercise(
    actionContext: ActionContext,
    id: number,
    options?: ResetOptions,
): Promise<Result<void, Error>> {
    const { ui, tmc, workspaceManager, logger } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(id);

    if (exerciseData.err) {
        const message = "The data for this exercise seems to be missing";
        showError(message);
        return new Err(exerciseData.val);
    }

    const submitFirst =
        options?.submitCurrent !== undefined
            ? options.submitCurrent
            : await askForItem(
                  "Do you want to save the current state of the exercise by submitting it to TMC Server?",
                  false,
                  ["Yes", true],
                  ["No", false],
                  ["Cancel", undefined],
              );

    if (submitFirst === undefined) {
        return Ok.EMPTY;
    } else if (submitFirst) {
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
    actionContext: ActionContext,
    ids: number[],
): Promise<Result<number[], Error>> {
    const { workspaceManager, logger, ui } = actionContext;

    const filterIds = ids.filter((id) => workspaceManager.exerciseExists(id));
    const result = workspaceManager.openExercise(...filterIds);
    const errors = result.filter((file) => file.err);

    if (errors.length !== 0) {
        errors.forEach((e) =>
            logger.error("Error when opening file", e.mapErr((err) => err.message).val),
        );
        return new Err(new Error("Something went wrong while opening exercises."));
    }
    ui.webview.postMessage(
        ...filterIds.map<{ key: string; message: WebviewMessage }>((exerciseId) => ({
            key: `exercise-${exerciseId}-status`,
            message: {
                command: "exerciseStatusChange",
                exerciseId,
                status: "opened",
            },
        })),
    );
    return new Ok(filterIds);
}

/**
 * Closes given exercises, hiding them from TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function closeExercises(
    actionContext: ActionContext,
    ids: number[],
): Promise<Result<number[], Error>> {
    const { workspaceManager, logger, ui } = actionContext;

    const filterIds = ids.filter((id) => workspaceManager.exerciseExists(id));
    const result = workspaceManager.closeExercise(...filterIds);
    const errors = result.filter((file) => file.err);

    if (errors.length !== 0) {
        errors.forEach((e) =>
            logger.error("Error when closing file", e.mapErr((err) => err.message).val),
        );
        return new Err(new Error("Something went wrong while closing exercises."));
    }
    ui.webview.postMessage(
        ...filterIds.map<{ key: string; message: WebviewMessage }>((exerciseId) => ({
            key: `exercise-${exerciseId}-status`,
            message: {
                command: "exerciseStatusChange",
                exerciseId,
                status: "closed",
            },
        })),
    );
    return new Ok(filterIds);
}

/**
 * Looks for older submissions of the given exercise and lets user choose which one to download.
 * Uses resetExercise action before applying the contents of the actual submission.
 *
 * @param exerciseId exercise which older submission will be downloaded
 */
export async function downloadOldSubmissions(
    actionContext: ActionContext,
    exerciseId: number,
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
        logger.log("No previoussubmissions found for exercise", exerciseId);
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

    if (!submission) {
        return;
    }

    const resetResult = await resetExercise(actionContext, exerciseId);
    if (resetResult.err) {
        const message = `Something went wrong while downloading old submission for exercise: ${resetResult.val}`;
        logger.error(message);
        showError(message);
        return;
    }

    const oldSub = await tmc.downloadOldExercise(exercise.val.id, submission.id);
    if (oldSub.err) {
        const message = `Something went wrong while downloading old submission for exercise: ${oldSub.val}`;
        logger.error(message);
        showError(message);
        return;
    }
}
