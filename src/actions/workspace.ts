/**
 * -------------------------------------------------------------------------------------------------
 * Group for actions that modify the TMC workspace.
 * -------------------------------------------------------------------------------------------------
 */

import { compact } from "lodash";
import { Ok, Result } from "ts-results";

import { ExerciseStatus } from "../api/workspaceManager";
import { TmcPanel } from "../panels/TmcPanel";
import { CourseDetailsPanel, ExtensionToWebview, TargetPanel } from "../shared/shared";
import * as UITypes from "../ui/types";
import { Logger } from "../utilities";

import { ActionContext } from "./types";

/**
 * Opens given exercises, showing them in TMC workspace.
 * @param exerciseIdsToOpen Array of exercise IDs
 */
export async function openExercises(
    actionContext: ActionContext,
    exerciseIdsToOpen: number[],
    courseName: string,
): Promise<Result<number[], Error>> {
    Logger.info("Opening exercises", exerciseIdsToOpen);

    const { workspaceManager, ui, userData, tmc } = actionContext;

    const course = userData.getCourseByName(courseName);
    const courseExercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exercisesToOpen = compact(exerciseIdsToOpen.map((x) => courseExercises.get(x)));

    const openResult = await workspaceManager.openCourseExercises(
        courseName,
        exercisesToOpen.map((e) => e.name),
    );
    if (openResult.err) {
        return openResult;
    }

    const closedExerciseNames = workspaceManager
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await tmc.setSetting(
        `closed-exercises-for:${courseName}`,
        closedExerciseNames,
    );
    if (settingsResult.err) {
        return settingsResult;
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
    const { workspaceManager, ui, userData, tmc } = actionContext;

    const course = userData.getCourseByName(courseName);
    const exercises = new Map(course.exercises.map((x) => [x.id, x]));
    const exerciseSlugs = compact(ids.map((x) => exercises.get(x)?.name));

    const closeResult = await workspaceManager.closeCourseExercises(courseName, exerciseSlugs);
    if (closeResult.err) {
        return closeResult;
    }

    const slugToId = new Map(Array.from(exercises.entries(), ([key, val]) => [val.name, key]));
    const closedIds = closeResult.val.map((exercise) => slugToId.get(exercise.exerciseSlug) || 0);

    const closedExerciseNames = workspaceManager
        .getExercisesByCourseSlug(courseName)
        .filter((x) => x.status === ExerciseStatus.Closed)
        .map((x) => x.exerciseSlug);
    const settingsResult = await tmc.setSetting(
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
