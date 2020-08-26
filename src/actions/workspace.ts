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
import { ExerciseStatus, LocalExerciseData } from "../config/types";
import { ExerciseExistsError } from "../errors";
import * as UITypes from "../ui/types";
import { Logger, sleep } from "../utils";
import { compareDates, dateToString, parseDate } from "../utils/dateDeadline";
import { askForItem, showError, showNotification, showProgressNotification } from "../window";

import { ActionContext, CourseExerciseDownloads } from "./types";

const limit = pLimit(3);

interface DownloadExercisesOptions {
    skipOldSubmissionCheck?: boolean;
}

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param courseExerciseDownloads An array of course-related data that is required for downloading.
 * @returns An array of successful downloads.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    courseExerciseDownloads: CourseExerciseDownloads[],
    options?: DownloadExercisesOptions,
): Promise<number[]> {
    const { tmc, ui, workspaceManager, settings } = actionContext;

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

    let oldSubmissionDownloaded = false;
    const successful: LocalExerciseData[] = [];
    const failed: LocalExerciseData[] = [];

    const resolveTask = async (
        result: Result<void, Error>,
        state: LocalExerciseData,
    ): Promise<void> => {
        postChange({
            exerciseId: state.id,
            status: result.ok ? "closed" : "downloadFailed",
        });
        if (result.ok || result.val instanceof ExerciseExistsError) {
            successful.push(state);
            workspaceManager.setExerciseChecksum(state.id, state.checksum);
            workspaceManager.updateExercisesStatus(state.id, ExerciseStatus.CLOSED);
        } else {
            failed.push(state);
            await workspaceManager.deleteExercise(state.id);
            Logger.error(`Failed to download ${state.organization}/${state.name}`, result.val);
        }
    };

    const task = async (
        process: vscode.Progress<{ downloadedPct: number; increment: number }>,
        state: LocalExerciseData,
    ): Promise<void> => {
        const dataResult = workspaceManager.getExerciseDataById(state.id);
        if (
            dataResult.ok &&
            dataResult.val.checksum === state.checksum &&
            dataResult.val.status !== ExerciseStatus.MISSING
        ) {
            resolveTask(
                Err(new ExerciseExistsError("Skipping download of already existing exercise.")),
                state,
            );
            return;
        }

        const pathResult = dataResult.ok
            ? workspaceManager.getExercisePathById(state.id)
            : await workspaceManager.addExercise(state);
        if (pathResult.err) {
            resolveTask(pathResult, state);
            return;
        }

        const oldSubmissions = await tmc.getOldSubmissions(state.id);

        if (
            options?.skipOldSubmissionCheck ??
            (!settings.getDownloadOldSubmission() ||
                oldSubmissions.err ||
                oldSubmissions.val.length === 0)
        ) {
            await new Promise<void>((resolve) => {
                tmc.downloadExercise(state.id, pathResult.val, (downloadedPct, increment) =>
                    process.report({ downloadedPct, increment }),
                ).then((res: Result<void, Error>) => {
                    resolveTask(res, state);
                    resolve();
                });
            });
        } else {
            await new Promise<void>((resolve) => {
                tmc.downloadOldSubmission(
                    state.id,
                    pathResult.val,
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
            const courseResult = await tmc.getCourseDetails(ced.courseId);
            if (courseResult.err) {
                Logger.warn(
                    "Could not download exercises, course details not found: " +
                        `${courseResult.val.name} - ${courseResult.val.message}`,
                );
                return [];
            }

            const course = courseResult.val.course;
            return course.exercises
                .filter((x) => ced.exerciseIds.includes(x.id))
                .map<LocalExerciseData>((x) => ({
                    id: x.id,
                    name: x.name,
                    checksum: x.checksum,
                    course: course.name,
                    organization: ced.organizationSlug,
                    status: ExerciseStatus.MISSING,
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
): Promise<Array<Result<CourseExerciseDownloads, Error>>> {
    const { tmc, userData, workspaceManager } = actionContext;

    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    Logger.log(`Checking for exercise updates for courses ${courses.map((c) => c.name)}`);
    return await Promise.all(
        courses.map(async (course) => {
            const organizationSlug = course.organization;

            const detailsResult = await tmc.getCourseDetails(
                course.id,
                updateCheckOptions?.useCache ?? false,
            );
            if (detailsResult.err) {
                return detailsResult;
            }

            const exerciseIds = detailsResult.val.course.exercises.reduce<number[]>(
                (ids, exercise) => {
                    const exerciseResult = workspaceManager.getExerciseDataById(exercise.id);
                    return exerciseResult.ok && exerciseResult.val.checksum !== exercise.checksum
                        ? ids.concat(exercise.id)
                        : ids;
                },
                [],
            );

            return Ok({
                courseId: course.id,
                courseName: course.name,
                exerciseIds,
                organizationSlug,
            });
        }),
    );
}

export async function downloadExerciseUpdates(
    actionContext: ActionContext,
    coursesToUpdate: CourseExerciseDownloads[],
): Promise<Result<void, Error>> {
    const { ui } = actionContext;

    ui.webview.postMessage({
        key: "course-updates",
        message: { command: "setUpdateables", exerciseIds: [] },
    });

    const successful = await downloadExercises(actionContext, coursesToUpdate, {
        skipOldSubmissionCheck: true,
    });

    const toUpdate = _.flatten(coursesToUpdate.map((x) => x.exerciseIds));

    ui.webview.postMessage({
        key: "course-updates",
        message: { command: "setUpdateables", exerciseIds: _.intersection(toUpdate, successful) },
    });

    // TODO: Get informative data from downloadExercises
    return Ok.EMPTY;
}

/**
 * Removes language specific meta files from exercise directory.
 * @param id ID of the exercise to reset.
 */
export async function cleanExercise(
    actionContext: ActionContext,
    id: number,
): Promise<Result<void, Error>> {
    const { tmc, workspaceManager } = actionContext;
    const exerciseFolderPath = workspaceManager.getExercisePathById(id);
    if (exerciseFolderPath.err) {
        return exerciseFolderPath;
    }
    const cleanResult = await tmc.clean(exerciseFolderPath.val);
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
    const { tmc, workspaceManager } = actionContext;

    const exerciseData = workspaceManager.getExerciseDataById(id);
    if (exerciseData.err) {
        return exerciseData;
    }
    const exercise = exerciseData.val;

    const pathResult = workspaceManager.getExercisePathById(id);
    if (pathResult.err) {
        return pathResult;
    }

    Logger.log(`Resetting exercise ${exercise.name}`);

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

    const resetResult = await tmc.resetExercise(id, pathResult.val, submitFirst);
    if (resetResult.err) {
        return resetResult;
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

    const pathResult = workspaceManager.getExercisePathById(exerciseId);
    if (pathResult.err) {
        return pathResult;
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
        pathResult.val,
        submission.id,
        submitFirst,
    );
    if (downloadResult.err) {
        return downloadResult;
    }
    return Ok(true);
}
