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
import {
    CourseDetailsPanel,
    CourseIdentifier,
    ExerciseIdentifier,
    ExtensionToWebview,
    LocalCourseData,
    LocalCourseExercise,
    match,
} from "../shared/shared";
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
    exerciseIdsToOpen: ExerciseIdentifier[],
    courseId: CourseIdentifier,
): Promise<Result<Array<ExerciseIdentifier>, Error>> {
    Logger.info("Opening exercises", exerciseIdsToOpen);

    const { workspaceManager, userData, langs, dialog } = actionContext;
    if (!(userData.ok && workspaceManager.ok && langs.ok)) {
        return Err(new Error("Extension was not initialized properly"));
    }

    const course = userData.val.getCourse(courseId);
    const courseExercises = new Map(
        LocalCourseData.getExercises(course).map((x) => [x.data.id, x]),
    );
    const exercisesToOpen = compact(
        exerciseIdsToOpen.map((x) => courseExercises.get(ExerciseIdentifier.unwrap(x))),
    );

    const courseName = match(
        course,
        (tmc) => tmc.name,
        (mooc) => mooc.courseName,
    );
    const openResult = await workspaceManager.val.openCourseExercises(
        course.kind,
        courseName,
        exercisesToOpen.map(LocalCourseExercise.getSlug),
    );
    if (openResult.err) {
        return openResult;
    }

    const closedExerciseNames = workspaceManager.val
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await langs.val.setSetting(
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
                        courseId,
                        exerciseGroups: [],
                        exerciseStatuses: {
                            tmc: {},
                            mooc: {},
                        },
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
    ids: Array<ExerciseIdentifier>,
    courseId: CourseIdentifier,
): Promise<Result<Array<ExerciseIdentifier>, Error>> {
    const { workspaceManager, userData, langs } = actionContext;
    if (!(userData.ok && workspaceManager.ok && langs.ok)) {
        return Err(new Error("Extension was not initialized properly"));
    }

    const course = userData.val.getCourse(courseId);
    const exercises = new Map(LocalCourseData.getExercises(course).map((x) => [x.data.id, x]));
    const exerciseSlugs = compact(
        ids.map((x) => {
            const exercise = exercises.get(ExerciseIdentifier.unwrap(x));
            if (!exercise) {
                return undefined;
            }
            return match(
                exercise,
                (tmc) => tmc.name,
                (mooc) => mooc.id,
            );
        }),
    );

    const courseName = LocalCourseData.getCourseName(course);
    const closeResult = await workspaceManager.val.closeCourseExercises(
        course.kind,
        courseName,
        exerciseSlugs,
    );
    if (closeResult.err) {
        return closeResult;
    }

    const slugToId = new Map(
        Array.from(exercises.entries(), ([key, val]) => [
            LocalCourseExercise.getSlug(val),
            ExerciseIdentifier.from(key),
        ]),
    );
    const closedIds = closeResult.val
        .map((exercise) => slugToId.get(exercise.exerciseSlug))
        .filter((e) => e !== undefined);

    const closedExerciseNames = workspaceManager.val
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await langs.val.setSetting(
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
