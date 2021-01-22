import { Result } from "ts-results";
import * as vscode from "vscode";

import { ExerciseStatus } from "../api/workspaceManager";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";

/**
 * Moves physical location of all exercises on disk. Closes active course workspace's exercises for
 * the duration of transfer.
 *
 * @param newPath New disk location for exercises.
 */
export async function moveExtensionDataPath(
    actionContext: ActionContext,
    newPath: vscode.Uri,
    onUpdate?: (value: { percent: number; message?: string }) => void,
): Promise<Result<void, Error>> {
    const { settings, tmc, workspaceManager } = actionContext;

    const activeCourse = workspaceManager.activeCourse;
    if (activeCourse) {
        const exercisesToClose = workspaceManager
            .getExercisesByCourseSlug(activeCourse)
            .filter((x) => x.status === ExerciseStatus.Open)
            .map((x) => x.exerciseSlug);
        const closeResult = await workspaceManager.closeCourseExercises(
            activeCourse,
            exercisesToClose,
        );
        if (closeResult.err) {
            return closeResult;
        }
    }

    const moveResult = await tmc.moveProjectsDirectory(newPath.fsPath, onUpdate);
    if (moveResult.err) {
        return moveResult;
    }

    await settings.updateSetting({ setting: "dataPath", value: newPath.fsPath });
    return refreshLocalExercises(actionContext);
}
