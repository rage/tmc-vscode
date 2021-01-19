/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import { compact, groupBy } from "lodash";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { ExerciseStatus } from "../api/workspaceManager";
import * as UITypes from "../ui/types";
import { incrementPercentageWrapper } from "../window";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext, CourseClosedExercises } from "./types";

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param exerciseIds Exercises to download.
 */
export async function downloadOrUpdateExercises(
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

/**
 * Opens given exercises, showing them in TMC workspace.
 * @param ids Array of exercise IDs
 */
export async function openExercises(
    actionContext: ActionContext,
    ids: number[],
    courseName: string,
): Promise<Result<number[], Error>> {
    const { workspaceManager, ui, userData, tmc } = actionContext;

    const course = userData.getCourseByName(courseName);
    const exercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exerciseSlugs = compact(ids.map((x) => exercises.get(x)?.name));

    const openResult = await workspaceManager.openCourseExercises(courseName, exerciseSlugs);
    if (openResult.err) {
        return openResult;
    }

    const updatedExercises = groupBy(workspaceManager.getExercises(), (x) => x.courseSlug);
    const mapped = Object.keys(updatedExercises).map<CourseClosedExercises>((x) => ({
        "course-slug": x,
        exercises: updatedExercises[x]
            .filter((x) => x.status === ExerciseStatus.Closed)
            .map((x) => x.exerciseSlug),
    }));
    const settingResult = await tmc.setSetting("closed-exercises", JSON.stringify(mapped));
    if (settingResult.err) {
        return settingResult;
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
    const { workspaceManager, ui, userData, tmc } = actionContext;

    const course = userData.getCourseByName(courseName);
    const exercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exerciseSlugs = compact(ids.map((x) => exercises.get(x)?.name));

    const closeResult = await workspaceManager.closeCourseExercises(courseName, exerciseSlugs);
    if (closeResult.err) {
        return closeResult;
    }

    const updatedExercises = groupBy(workspaceManager.getExercises(), (x) => x.courseSlug);
    const mapped = Object.keys(updatedExercises).map<CourseClosedExercises>((x) => ({
        "course-slug": x,
        exercises: updatedExercises[x]
            .filter((x) => x.status === ExerciseStatus.Closed)
            .map((x) => x.exerciseSlug),
    }));
    const settingResult = await tmc.setSetting("closed-exercises", JSON.stringify(mapped));
    if (settingResult.err) {
        return settingResult;
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
