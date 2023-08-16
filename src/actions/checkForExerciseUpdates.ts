import { flatten } from "lodash";
import { Ok, Result } from "ts-results";

import { Logger } from "../utils";

import { ActionContext } from "./types";

interface Options {
    forceRefresh?: boolean;
}

interface OutdatedExercise {
    courseId: number;
    exerciseName: string;
    exerciseId: number;
}

/**
 * Checks all user's courses for exercise updates.
 * @param courseId If given, check only updates for that course.
 */
export async function checkForExerciseUpdates(
    actionContext: ActionContext,
    options?: Options,
): Promise<Result<OutdatedExercise[], Error>> {
    const { tmc, userData } = actionContext;
    const forceRefresh = options?.forceRefresh ?? false;
    Logger.info(`Checking for exercise updates, forced update: ${forceRefresh}`);

    const checkUpdatesResult = await tmc.checkExerciseUpdates({ forceRefresh });
    if (checkUpdatesResult.err) {
        return checkUpdatesResult;
    }

    const updateableExerciseIds = new Set<number>(checkUpdatesResult.val.map((x) => x.id));
    const outdatedExercisesByCourse = userData.getCourses().map<OutdatedExercise[]>((course) => {
        const outdatedExercises = course.exercises.filter((x) => updateableExerciseIds.has(x.id));
        return outdatedExercises.map((x) => ({
            courseId: course.id,
            exerciseId: x.id,
            exerciseName: x.name,
        }));
    });
    const outdatedExercises = flatten(outdatedExercisesByCourse);
    Logger.info(`Update check found ${outdatedExercises.length} outdated exercises`);
    return Ok(outdatedExercises);
}
