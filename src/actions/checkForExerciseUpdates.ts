import { flatten } from "lodash";
import { Ok, Result } from "ts-results";

import { assertUnreachable } from "../shared/shared";
import { Logger } from "../utilities";

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
 */
// todo: mooc
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
        switch (course.kind) {
            case "tmc": {
                const tmcCourse = course.data;
                const outdatedExercises = tmcCourse.exercises.filter((x) => updateableExerciseIds.has(x.id));
                return outdatedExercises.map((x) => ({
                    courseId: tmcCourse.id,
                    exerciseId: x.id,
                    exerciseName: x.name,
                }));
            }
            case "mooc": {
                throw new Error("todo")
            }
            default: {
                assertUnreachable(course)
            }
        }
    });
    const outdatedExercises = flatten(outdatedExercisesByCourse);
    Logger.info(`Update check found ${outdatedExercises.length} outdated exercises`);
    return Ok(outdatedExercises);
}
