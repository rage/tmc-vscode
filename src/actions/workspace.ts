/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import { compact } from "lodash";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import * as UITypes from "../ui/types";
import { incrementPercentageWrapper } from "../window";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";

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
 * @param exerciseIds Exercises to download.
 */
export async function downloadExercises(
    actionContext: ActionContext,
    exerciseIds: number[],
): Promise<Result<void, Error>> {
    const { tmc, ui } = actionContext;

    // TODO: How to download latest submission in new version?
    const downloadResult = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "TestMyCode",
        },
        (progress) => {
            const progress2 = incrementPercentageWrapper(progress);
            return tmc.downloadExercises(exerciseIds, (download) => {
                progress2.report(download);
                ui.webview.postMessage({
                    command: "exerciseStatusChange",
                    exerciseId: download.id,
                    status: "closed",
                });
            });
        },
    );
    if (downloadResult.err) {
        return downloadResult;
    }

    const refreshResult = await refreshLocalExercises(actionContext);
    if (refreshResult.err) {
        return refreshResult;
    }

    return Ok.EMPTY;
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
