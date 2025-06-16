/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import * as vscode from "vscode";

import { compact } from "lodash";
import { Err, Ok, Result } from "ts-results";
import { ExerciseStatus } from "../api/workspaceManager";
import { randomPanelId, TmcPanel } from "../panels/TmcPanel";
import { CourseDetailsPanel, ExtensionToWebview } from "../shared/shared";
import { Logger } from "../utilities";
import * as systeminformation from "systeminformation";
import { ActionContext } from "./types";

/**
 * Opens given exercises, showing them in TMC workspace.
 * @param exerciseIdsToOpen Array of exercise IDs
 */
export async function openExercises(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
    exerciseIdsToOpen: number[],
    courseName: string,
): Promise<Result<number[], Error>> {
    Logger.info("Opening exercises", exerciseIdsToOpen);

    const { workspaceManager, userData, tmc, dialog } = actionContext;
    if (!(userData.ok && workspaceManager.ok && tmc.ok)) {
        return Err(new Error("Extension was not initialized properly"));
    }

    const course = userData.val.getCourseByName(courseName);
    const courseExercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exercisesToOpen = compact(exerciseIdsToOpen.map((x) => courseExercises.get(x)));

    const openResult = await workspaceManager.val.openCourseExercises(
        courseName,
        exercisesToOpen.map((e) => e.name),
    );
    if (openResult.err) {
        return openResult;
    }

    const closedExerciseNames = workspaceManager.val
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await tmc.val.setSetting(
        `closed-exercises-for:${courseName}`,
        closedExerciseNames,
    );
    if (settingsResult.err) {
        return settingsResult;
    }

    // check open exercise count and warn if it's too high
    const under8GbRam = (await systeminformation.mem()).available < 9_000_000_000;
    const weakThreshold = 50;
    const strongThreshold = 100;
    const warningThreshold = under8GbRam ? weakThreshold : strongThreshold;
    const openExercises = workspaceManager.val
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Open);
    if (openExercises.length > warningThreshold) {
        dialog.warningNotification(
            `You have over ${warningThreshold} exercises open, which may cause performance issues. You can close completed exercises from the TMC extension menu in the sidebar.`,
            [
                "Open course details",
                (): void => {
                    const panel: CourseDetailsPanel = {
                        id: randomPanelId(),
                        type: "CourseDetails",
                        courseId: course.id,
                    };
                    TmcPanel.renderMain(context.extensionUri, context, actionContext, panel);
                },
            ],
        );
    }

    TmcPanel.postMessage(
        ...exerciseIdsToOpen.map<ExtensionToWebview>((id) => ({
            type: "exerciseStatusChange",
            exerciseId: id,
            status: "opened",
            target: {
                type: "CourseDetails",
            },
        })),
    );

    return new Ok(exerciseIdsToOpen);
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
    const { workspaceManager, userData, tmc } = actionContext;
    if (!(userData.ok && workspaceManager.ok && tmc.ok)) {
        return Err(new Error("Extension was not initialized properly"));
    }

    const course = userData.val.getCourseByName(courseName);
    const exercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exerciseSlugs = compact(ids.map((x) => exercises.get(x)?.name));

    const closeResult = await workspaceManager.val.closeCourseExercises(courseName, exerciseSlugs);
    if (closeResult.err) {
        return closeResult;
    }

    const slugToId = new Map(Array.from(exercises.entries(), ([key, val]) => [val.name, key]));
    const closedIds = closeResult.val.map((exercise) => slugToId.get(exercise.exerciseSlug) || 0);

    const closedExerciseNames = workspaceManager.val
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await tmc.val.setSetting(
        `closed-exercises-for:${courseName}`,
        closedExerciseNames,
    );
    if (settingsResult.err) {
        return settingsResult;
    }

    TmcPanel.postMessage(
        ...closedIds.map<ExtensionToWebview>((id) => ({
            type: "exerciseStatusChange",
            exerciseId: id,
            status: "closed",
            target: {
                type: "CourseDetails",
            },
        })),
    );
    const exerciseStatusChangeMessages = closedIds.map<ExtensionToWebview>((id) => ({
        type: "exerciseStatusChange",
        target: {
            type: "CourseDetails",
        },
        exerciseId: id,
        status: "closed",
    }));
    TmcPanel.postMessage(...exerciseStatusChangeMessages);

    return new Ok(closedIds);
}
