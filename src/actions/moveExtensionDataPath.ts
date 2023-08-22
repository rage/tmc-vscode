import * as fs from "fs-extra";
import * as path from "path";
import { Result } from "ts-results";
import * as vscode from "vscode";

import { Logger } from "../utilities";

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
    const { resources, tmc } = actionContext;
    Logger.info("Moving extension data path");

    // This appears to be unnecessary with current VS Code version
    /*
    const activeCourse = workspaceManager.activeCourse;
    if (activeCourse) {
        const exercisesToClose = workspaceManager
            .getExercisesByCourseSlug(activeCourse)
            .filter((x) => x.status === ExerciseStatus.Open)
            .map((x) => x.exerciseSlug);

        // Close exercises without writing the result to "reopen" them with refreshLocalExercises
        const closeResult = await workspaceManager.closeCourseExercises(
            activeCourse,
            exercisesToClose,
        );
        if (closeResult.err) {
            return closeResult;
        }
    }
    */

    // Use given path if empty dir, otherwise append
    let newFsPath = newPath.fsPath;
    if (fs.readdirSync(newFsPath).length > 0) {
        newFsPath = path.join(newFsPath, "tmcdata");
    }

    const moveResult = await tmc.moveProjectsDirectory(newFsPath, onUpdate);
    if (moveResult.err) {
        return moveResult;
    }

    resources.projectsDirectory = newFsPath;
    return refreshLocalExercises(actionContext);
}
