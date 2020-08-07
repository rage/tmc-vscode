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
import { askForItem, showError, showNotification, showProgressNotification } from "../api/vscode";
import { NOTIFICATION_DELAY } from "../config/constants";
import { ExerciseStatus } from "../config/types";
import * as UITypes from "../ui/types";
import { Logger } from "../utils";
import { dateToString, parseDate } from "../utils/dateDeadline";

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
    const { tmc, ui } = actionContext;

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
                    Logger.error(
                        `Failed to download ${state.organizationSlug}/${state.name}`,
                        res.val,
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
            (state) => (
                p: vscode.Progress<{ downloadedPct: number; increment: number }>,
            ): Promise<void> => limit(() => task(p, state)),
        ),
    );

    if (failed.length > 0) {
        const message = "Some exercises failed to download, please try again later.";
        Logger.warn(message);
        showError(message);
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

    const exercisePath = workspaceManager.getExercisePathById(id);
    if (exercisePath.err) {
        return exercisePath;
    }

    const exercise = exerciseData.val;
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
        const dlResult = await tmc.downloadExercise(id, exercise.organization);
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
    const { settings, tmc, workspaceManager } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(exerciseId);
    if (exerciseData.err) {
        return exerciseData;
    }
    const exercise = exerciseData.val;

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

    if (settings.isInsider()) {
        console.warn("Using insider feature");
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
            submission.id,
            submitFirst,
        );
        if (downloadResult.err) {
            return downloadResult;
        }
    } else {
        const resetResult = await resetExercise(actionContext, exerciseId);
        if (resetResult.err) {
            return resetResult;
        }

        const oldSub = await tmc.downloadOldExercise(exerciseData.val.id, submission.id);
        if (oldSub.err) {
            return oldSub;
        }

        const openResult = await openExercises(
            actionContext,
            [exerciseData.val.id],
            exerciseData.val.course,
        );
        if (openResult.err) {
            return openResult;
        }
    }
    return Ok(true);
}
