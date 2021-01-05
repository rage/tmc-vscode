/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import * as _ from "lodash";
import { compact } from "lodash";
import * as path from "path";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { ExerciseStatus } from "../api/workspaceManager";
import * as UITypes from "../ui/types";

import { ActionContext, CourseExerciseDownloads } from "./types";

interface ExerciseDownload {
    courseId: number;
    exerciseId: number;
    organization: string;
}

interface SuccessfulDownload extends ExerciseDownload {
    type: "default" | "oldSubmission" | "update";
}

interface FailedDownload extends ExerciseDownload {
    error: Error;
}

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param exercises Exercises to download.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    exercises: Array<{ id: number; courseName: string }>,
): Promise<{ downloaded: number[]; failed: number[]; error?: Error }> {
    const { tmc, workspaceManager } = actionContext;

    // TODO: How to download latest submission in new version?
    const idToData = new Map(exercises.map((x) => [x.id, x]));
    const downloaded: number[] = [];
    const result = await tmc.downloadExercises(
        exercises.map((x) => x.id),
        (download) => {
            const exerciseName = _.last(download.path.split(path.sep));
            const data = idToData.get(download.id);
            if (!data || !exerciseName) {
                return;
            }

            workspaceManager.addExercise({
                courseSlug: data.courseName,
                exerciseSlug: exerciseName,
                status: ExerciseStatus.Closed,
                uri: vscode.Uri.file(download.path),
            });
            downloaded.push(download.id);
        },
    );
    const failed = _.difference(
        exercises.map((x) => x.id),
        downloaded,
    );

    return { downloaded, failed, error: result.err ? result.val : undefined };
}

interface UpdateCheckOptions {
    useCache?: boolean;
}

/**
 * Checks all user's courses for exercise updates and download them.
 * @param courseId If given, check only updates for that course.
 */
export async function checkForExerciseUpdates(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    actionContext: ActionContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    courseId?: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    updateCheckOptions?: UpdateCheckOptions,
): Promise<Array<Result<CourseExerciseDownloads, Error>>> {
    // TODO: Reimplement without needing checksums
    return [];

    /*
    const { tmc, userData, workspaceManager } = actionContext;

    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    const filteredCourses = courses.filter((c) => !c.disabled);
    Logger.log(`Checking for exercise updates for courses ${filteredCourses.map((c) => c.name)}`);
    return await Promise.all(
        filteredCourses.map(async (course) => {
            const organizationSlug = course.organization;

            const detailsResult = await tmc.getCourseDetails(course.id, {
                forceRefresh: updateCheckOptions?.useCache,
            });
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
    */
}

export async function downloadExerciseUpdates(
    actionContext: ActionContext,
    exercisesToDownload: ExerciseDownload[],
): Promise<[SuccessfulDownload[], FailedDownload[]]> {
    // TODO: Reimplement without needing checksums
    return [[], exercisesToDownload.map((x) => ({ ...x, error: new Error("No op") }))];

    /*
    const { tmc, ui, workspaceManager } = actionContext;

    const exercises = _.uniq(exercisesToDownload);
    const courses = new Map(
        _(exercises)
            .map((x) => x.courseId)
            .uniq()
            .value()
            .map<[number, Promise<Result<CourseDetails, Error>>]>((x) => [
                x,
                tmc.getCourseDetails(x),
            ]),
    );

    ui.webview.postMessage(
        ...exercises.map<UITypes.WebviewMessage>((x) => ({
            command: "exerciseStatusChange",
            exerciseId: x.exerciseId,
            status: "downloading",
        })),
    );

    const task = async (
        exerciseDownload: ExerciseDownload,
        process: vscode.Progress<{ downloadedPct: number; increment: number }>,
    ): Promise<Result<SuccessfulDownload, FailedDownload>> => {
        const { courseId, exerciseId, organization } = exerciseDownload;

        const wrapError = (error: Error, status: UITypes.ExerciseStatus): Err<FailedDownload> => {
            ui.webview.postMessage({ command: "exerciseStatusChange", exerciseId, status });
            return Err({ courseId, exerciseId, organization, error });
        };

        const dataResult = Result.all(
            workspaceManager.getExerciseDataById(exerciseId),
            workspaceManager.getExercisePathById(exerciseId),
        );
        if (dataResult.err) {
            return wrapError(dataResult.val, "missing");
        }

        const [data, path] = dataResult.val;
        if (data.status === ExerciseStatus.MISSING) {
            return wrapError(new Error("Exercise is missing."), "missing");
        }

        const status = data.status === ExerciseStatus.OPEN ? "opened" : "closed";

        const courseResult = (await courses.get(courseId)) as Result<CourseDetails, Error>;
        if (courseResult.err) {
            return wrapError(courseResult.val, status);
        }

        // Delegate checking and obtaining new checksum to langs?
        const newChecksum = courseResult.val.course.exercises.find((x) => x.id === exerciseId)
            ?.checksum;
        if (!newChecksum) {
            return wrapError(new Error("Exercise data missing from server."), status);
        }

        if (newChecksum === data.checksum) {
            return wrapError(new Error("Exercise is already up to date."), status);
        }
        // Until here

        const updateResult = await tmc.downloadExercise(
            exerciseId,
            path,
            (downloadedPct, increment) => process.report({ downloadedPct, increment }),
        );
        if (updateResult.err) {
            return wrapError(updateResult.val, status);
        }

        ui.webview.postMessage({ command: "exerciseStatusChange", exerciseId, status });
        workspaceManager.setExerciseChecksum(exerciseId, newChecksum);
        return Ok<SuccessfulDownload>({ ...exerciseDownload, type: "update" });
    };

    const updateResults = await showProgressNotification(
        `Updating ${exercises.length} exercises...`,
        ...exercises.map(
            (x) => async (
                p: vscode.Progress<{ downloadedPct: number; increment: number }>,
            ): Promise<Result<SuccessfulDownload, FailedDownload>> => limit(() => task(x, p)),
        ),
    );

    return updateResults.reduce<[SuccessfulDownload[], FailedDownload[]]>(
        ([s, f], next) => (next.ok ? [s.concat(next.val), f] : [s, f.concat(next.val)]),
        [[], []],
    );
    */
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
    const { workspaceManager, ui, userData } = actionContext;

    const course = userData.getCourseByName(courseName);
    const exercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exerciseSlugs = compact(ids.map((x) => exercises.get(x)?.name));

    const result = await workspaceManager.openCourseExercises(courseName, exerciseSlugs);
    if (result.err) {
        return result;
    }

    const courseExercises = workspaceManager.getExercisesByCourseSlug(courseName);
    ui.webview.postMessage(
        ...courseExercises.map<UITypes.WebviewMessage>((ex) => ({
            command: "exerciseStatusChange",
            exerciseId: course.exercises.find((x) => x.name === ex.exerciseSlug)?.id ?? -1,
            status: ex.status,
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
    const { workspaceManager, ui, userData } = actionContext;

    const course = userData.getCourseByName(courseName);
    const exercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exerciseSlugs = compact(ids.map((x) => exercises.get(x)?.name));

    const result = await workspaceManager.closeCourseExercises(courseName, exerciseSlugs);
    if (result.err) {
        return result;
    }

    const courseExercises = workspaceManager.getExercisesByCourseSlug(courseName);
    ui.webview.postMessage(
        ...courseExercises.map<UITypes.WebviewMessage>((ex) => ({
            command: "exerciseStatusChange",
            exerciseId: course.exercises.find((x) => x.name === ex.exerciseSlug)?.id ?? -1,
            status: ex.status,
        })),
    );
    return new Ok(ids);
}
