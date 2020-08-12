/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import * as fs from "fs-extra";
import * as _ from "lodash";
import * as pLimit from "p-limit";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { OldSubmission } from "../api/types";
import { NOTIFICATION_DELAY } from "../config/constants";
import { ExerciseStatus } from "../config/types";
import { ExerciseExistsError } from "../errors";
import * as UITypes from "../ui/types";
import { Logger, sleep } from "../utils";
import { compareDates, dateToString, parseDate } from "../utils/dateDeadline";
import { askForItem, showError, showNotification, showProgressNotification } from "../window";

import { ActionContext, CourseExerciseDownloads } from "./types";

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
    const { tmc, ui, workspaceManager } = actionContext;

    interface StatusChange {
        exerciseId: number;
        status: UITypes.ExerciseStatus;
    }

    const postChange = (...changes: StatusChange[]): void =>
        ui.webview.postMessage(
            ...changes.map<{ key: string; message: UITypes.WebviewMessage }>(
                ({ exerciseId, status }) => ({
                    key: `exercise-${exerciseId}-status`,
                    message: {
                        command: "exerciseStatusChange",
                        exerciseId,
                        status,
                    },
                }),
            ),
        );

    type DownloadState = {
        id: number;
        name: string;
        organizationSlug: string;
    };

    let oldSubmissionDownloaded = false;
    const successful: DownloadState[] = [];
    const failed: DownloadState[] = [];

    const resolveTask = async (
        result: Result<void, Error>,
        state: DownloadState,
    ): Promise<void> => {
        postChange({
            exerciseId: state.id,
            status: result.ok ? "closed" : "downloadFailed",
        });
        if (result.ok || result.val instanceof ExerciseExistsError) {
            successful.push(state);
        } else {
            failed.push(state);
            await workspaceManager.deleteExercise(state.id);
            Logger.error(`Failed to download ${state.organizationSlug}/${state.name}`, result.val);
        }
    };

    const task = async (
        process: vscode.Progress<{ downloadedPct: number; increment: number }>,
        state: DownloadState,
    ): Promise<void> => {
        const oldSubmissions = await tmc.getOldSubmissions(state.id);
        const exercisePath = await createExerciseDownloadPath(
            actionContext,
            state.id,
            state.organizationSlug,
        );
        if (oldSubmissions.err || oldSubmissions.val.length === 0) {
            await new Promise<void>((resolve) => {
                if (exercisePath.err) {
                    failed.push(state);
                    return resolve();
                }
                tmc.downloadExercise(state.id, exercisePath.val, (downloadedPct, increment) =>
                    process.report({ downloadedPct, increment }),
                ).then((res: Result<void, Error>) => {
                    resolveTask(res, state);
                    resolve();
                });
            });
        } else {
            await new Promise<void>((resolve) => {
                if (exercisePath.err) {
                    failed.push(state);
                    return resolve();
                }
                tmc.downloadOldSubmission(
                    state.id,
                    exercisePath.val,
                    oldSubmissions.val.sort((a, b) =>
                        compareDates(
                            parseDate(b.processing_attempts_started_at),
                            parseDate(a.processing_attempts_started_at),
                        ),
                    )[0].id,
                    false,
                    (downloadedPct, increment) => process.report({ downloadedPct, increment }),
                ).then((res: Result<void, Error>) => {
                    oldSubmissionDownloaded = true;
                    resolveTask(res, state);
                    resolve();
                });
            });
        }
    };

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
                Logger.warn(
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

    Logger.log(`Starting to download ${exerciseStatuses.length} exercises`);
    await showProgressNotification(
        `Downloading ${exerciseStatuses.length} exercises...`,
        ...exerciseStatuses.map(
            (state) => async (
                p: vscode.Progress<{ downloadedPct: number; increment: number }>,
            ): Promise<void> => {
                // Need to wait here, so the notification pops up.
                await sleep(10);
                return limit(() => task(p, state));
            },
        ),
    );

    if (failed.length > 0) {
        const message = "Some exercises failed to download, please try again later.";
        Logger.warn(message);
        showError(message);
    }
    if (oldSubmissionDownloaded) {
        showNotification(
            "Some downloaded exercises were restored to the state of your latest submission. " +
                "If you wish to reset them to their original state, you can do so by using the TMC Menu (CTRL + SHIFT + A).",
            ["OK", (): void => {}],
        );
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
    const { tmc, userData, workspaceManager, ui } = actionContext;

    const coursesToUpdate: Map<number, CourseExerciseDownloads> = new Map();
    let count = 0;
    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    const filteredCourses = courses.filter((c) => c.notifyAfter <= Date.now() && !c.disabled);
    Logger.log(`Checking for exercise updates for courses ${filteredCourses.map((c) => c.name)}`);
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
            coursesToUpdate.set(course.id, {
                courseId: course.id,
                exerciseIds,
                organizationSlug,
                courseName: course.name,
            });
            count += exerciseIds.length;
        }
    }

    if (count > 0 && updateCheckOptions?.notify !== false) {
        showNotification(
            `Found updates for ${count} exercises. Do you wish to download them?`,
            [
                "Download",
                async (): Promise<void> => {
                    const successful = await downloadExercises(
                        actionContext,
                        Array.from(coursesToUpdate.values()),
                    );
                    ui.webview.postMessage({
                        key: "course-updates",
                        message: { command: "setUpdateables", exerciseIds: [] },
                    });
                    coursesToUpdate.forEach(async (courseDL) => {
                        const openResult = await openExercises(
                            actionContext,
                            _.intersection(successful, courseDL.exerciseIds),
                            courseDL.courseName,
                        );
                        if (openResult.err) {
                            const message = "Failed to open updated exercises.";
                            Logger.error(message, openResult.val);
                            showError(message);
                        }
                    });
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

/**
 * Removes language specific meta files from exercise directory.
 * @param id ID of the exercise to reset.
 */
export async function cleanExercise(
    actionContext: ActionContext,
    id: number,
): Promise<Result<void, Error>> {
    const { tmc } = actionContext;

    const cleanResult = await tmc.clean(id);
    if (cleanResult.err) {
        return cleanResult;
    }
    return Ok.EMPTY;
}

interface ResetOptions {
    /** Whether to open the exercise to workspace after reseting. */
    openAfterwards?: boolean;
    /** Whether to submit current state, asks user if not defined. */
    submitFirst?: boolean;
}

/**
 * Resets an exercise to its initial state. Optionally submits the exercise beforehand.
 *
 * @param id ID of the exercise to reset.
 * @param options Optional parameters that can be used to control the action behavior.
 */
export async function resetExercise(
    actionContext: ActionContext,
    id: number,
    options?: ResetOptions,
): Promise<Result<boolean, Error>> {
    const { settings, tmc, workspaceManager } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(id);
    if (exerciseData.err) {
        return exerciseData;
    }
    const exercise = exerciseData.val;

    const exercisePath = await createExerciseDownloadPath(actionContext, id, exercise.organization);
    if (exercisePath.err) {
        return exercisePath;
    }

    Logger.log(`Reseting exercise ${exercise.name}`);

    const submitFirst =
        options?.submitFirst !== undefined
            ? options.submitFirst
            : await askForItem(
                  "Do you want to save the current state of the exercise by submitting it to TMC Server?",
                  false,
                  ["Yes", true],
                  ["No", false],
                  ["Cancel", undefined],
              );

    if (submitFirst === undefined) {
        Logger.debug("Answer for submitting first not provided, returning early.");
        return Ok(false);
    }

    if (settings.isInsider()) {
        Logger.warn("Using insider feature");
        const resetResult = await tmc.resetExercise(id, submitFirst);
        if (resetResult.err) {
            return resetResult;
        }
    } else {
        if (submitFirst) {
            const submitResult = await tmc.submitExercise(id);
            if (submitResult.err) {
                return submitResult;
            }
        } else {
            Logger.debug("Didn't submit exercise before resetting.");
        }

        // Try to remove files here because new workspace
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(vscode.Uri.file(exercisePath.val), { recursive: true });
        const removeResult = await vscode.workspace.applyEdit(edit);
        if (!removeResult) {
            return Err(new Error("Failed to remove previous files before reseting."));
        }

        Logger.debug("Closing exercise before resetting.");
        if (exercise.status === ExerciseStatus.OPEN) {
            const closeResult = await closeExercises(actionContext, [id], exercise.course);
            if (closeResult.err) {
                return closeResult;
            }
        }

        await workspaceManager.deleteExercise(id);
        const dlResult = await tmc.downloadExercise(id, exercisePath.val);
        if (dlResult.err) {
            return dlResult;
        }

        if (options?.openAfterwards === true) {
            const openResult = await openExercises(actionContext, [id], exercise.course);
            if (openResult.err) {
                return openResult;
            }
        }
    }

    return Ok(true);
}

/**
 * Opens given exercises, showing them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function openExercises(
    actionContext: ActionContext,
    ids: number[],
    courseName: string,
): Promise<Result<number[], Error>> {
    const { workspaceManager, ui } = actionContext;

    const result = await workspaceManager.openExercise(courseName, ...ids);

    if (result.err) {
        return result;
    }

    ui.webview.postMessage(
        ...result.val.map<{ key: string; message: UITypes.WebviewMessage }>((ex) => ({
            key: `exercise-${ex.id}-status`,
            message: {
                command: "exerciseStatusChange",
                exerciseId: ex.id,
                status: ex.status,
            },
        })),
    );
    return new Ok(ids);
}

/**
 * Closes given exercises, hiding them from TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function closeExercises(
    actionContext: ActionContext,
    ids: number[],
    courseName: string,
): Promise<Result<number[], Error>> {
    const { workspaceManager, ui } = actionContext;

    const result = await workspaceManager.closeExercise(courseName, ...ids);

    if (result.err) {
        return result;
    }

    ui.webview.postMessage(
        ...result.val.map<{ key: string; message: UITypes.WebviewMessage }>((ex) => ({
            key: `exercise-${ex.id}-status`,
            message: {
                command: "exerciseStatusChange",
                exerciseId: ex.id,
                status: ex.status,
            },
        })),
    );
    return new Ok(ids);
}

interface DownloadOldSubmissionOptions {
    /** Whether to submit current state, asks user if not defined. */
    submitFirst?: boolean;
}

/**
 * Looks for older submissions of the given exercise and lets user choose which one to download.
 * Uses resetExercise action before applying the contents of the actual submission.
 *
 * @param exerciseId exercise which older submission will be downloaded
 */
export async function downloadOldSubmission(
    actionContext: ActionContext,
    exerciseId: number,
    options?: DownloadOldSubmissionOptions,
): Promise<Result<boolean, Error>> {
    const { tmc, workspaceManager } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
    if (exerciseData.err) {
        return exerciseData;
    }
    const exercise = exerciseData.val;

    const exercisePath = await createExerciseDownloadPath(
        actionContext,
        exerciseId,
        exercise.organization,
    );
    if (exercisePath.err) {
        return exercisePath;
    }

    Logger.debug("Fetching old submissions");
    const submissionsResult = await tmc.getOldSubmissions(exerciseId);
    if (submissionsResult.err) {
        return submissionsResult;
    }

    if (submissionsResult.val.length === 0) {
        Logger.log(`No previous submissions found for exercise ${exerciseId}`);
        showNotification(`No previous submissions found for ${exercise.name}.`);
        return Ok(false);
    }

    const submission = await askForItem(
        exerciseData.val.name + ": Select a submission",
        false,
        ...submissionsResult.val.map<[string, OldSubmission]>((a) => [
            dateToString(parseDate(a.processing_attempts_started_at)) +
                "| " +
                (a.all_tests_passed ? "Passed" : "Not passed"),
            a,
        ]),
    );

    if (!submission) {
        return Ok(false);
    }

    const submitFirst =
        options?.submitFirst !== undefined
            ? options.submitFirst
            : await askForItem(
                  "Do you want to save the current state of the exercise by submitting it to TMC Server?",
                  false,
                  ["Yes", true],
                  ["No", false],
                  ["Cancel", undefined],
              );

    if (submitFirst === undefined) {
        Logger.debug("Answer for submitting first not provided, returning early.");
        return Ok(false);
    }

    const downloadResult = await tmc.downloadOldSubmission(
        exerciseId,
        exercisePath.val,
        submission.id,
        submitFirst,
    );
    if (downloadResult.err) {
        return downloadResult;
    }
    return Ok(true);
}

/**
 * Checks if workspaceManager knows exercise by id and returns the exercise path.
 * Makes sure the path exists on disk and marks exercise as closed.
 *
 * Else, fetches all the necessary data and adds it to storage and returns path.
 *
 * @param actionContext
 * @param exerciseId
 * @param organizationSlug
 */
async function createExerciseDownloadPath(
    actionContext: ActionContext,
    exerciseId: number,
    organizationSlug: string,
): Promise<Result<string, Error>> {
    const { tmc, workspaceManager } = actionContext;

    const exercisePathResult = workspaceManager.getExercisePathById(exerciseId);
    if (exercisePathResult.ok) {
        if (!fs.existsSync(exercisePathResult.val)) {
            fs.mkdirSync(exercisePathResult.val, { recursive: true });
            await workspaceManager.setClosed(exerciseId);
        }
        return exercisePathResult;
    }

    const detailsResult = await tmc.getExerciseDetails(exerciseId, true);
    if (detailsResult.err) {
        return detailsResult;
    }

    const courseResult = await tmc.getCourseDetails(detailsResult.val.course_id);
    if (courseResult.err) {
        return courseResult;
    }

    const exercise = courseResult.val.course.exercises.find((x) => x.id === exerciseId);
    if (!exercise) {
        return new Err(new Error("Exercise missing from the course"));
    }

    const exercisePath = await workspaceManager.createExerciseDownloadPath(
        exercise.soft_deadline,
        organizationSlug,
        exercise.checksum,
        detailsResult.val,
    );

    if (exercisePath.err) {
        return exercisePath;
    }

    return exercisePath;
}
