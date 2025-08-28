import { Logger } from "../utilities";
import { ActionContext } from "./types";
import { flatten } from "lodash";
import { Err, Ok, Result } from "ts-results";

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
    if (!(tmc.ok && userData.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    const forceRefresh = options?.forceRefresh ?? false;
    Logger.info("Checking for exercise updates, forced update:", forceRefresh);

    const checkUpdatesResult = await tmc.val.checkExerciseUpdates({ forceRefresh });
    if (checkUpdatesResult.err) {
        return checkUpdatesResult;
    }

    const updateableExerciseIds = new Set<number>(checkUpdatesResult.val.map((x) => x.id));
    const outdatedExercisesByCourse = userData.val
        .getCourses()
        .map<OutdatedExercise[]>((course) => {
            const outdatedExercises = course.exercises.filter((x) =>
                updateableExerciseIds.has(x.id),
            );
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
