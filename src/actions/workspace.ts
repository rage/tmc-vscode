/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import { compact } from "lodash";
import { Ok, Result } from "ts-results";

import { ExerciseStatus } from "../api/workspaceManager";
import * as UITypes from "../ui/types";

import { ActionContext } from "./types";

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

    const closedExerciseNames = workspaceManager
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await tmc.setSetting(
        `closed-exercises-for:${courseName}`,
        JSON.stringify(closedExerciseNames),
    );
    if (settingsResult.err) {
        return settingsResult;
    }

    ui.webview.postMessage(
        ...ids.map<UITypes.WebviewMessage>((id) => ({
            command: "exerciseStatusChange",
            exerciseId: id,
            status: "opened",
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

    const closedExerciseNames = workspaceManager
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await tmc.setSetting(
        `closed-exercises-for:${courseName}`,
        JSON.stringify(closedExerciseNames),
    );
    if (settingsResult.err) {
        return settingsResult;
    }

    ui.webview.postMessage(
        ...ids.map<UITypes.WebviewMessage>((id) => ({
            command: "exerciseStatusChange",
            exerciseId: id,
            status: "closed",
        })),
    );

    return new Ok(ids);
}
