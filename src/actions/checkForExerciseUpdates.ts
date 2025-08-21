import { flatten } from "lodash";
import { Err, Ok, Result } from "ts-results";

import { assertUnreachable, CourseIdentifier, ExerciseIdentifier } from "../shared/shared";
import { Logger } from "../utilities";

import { ActionContext } from "./types";

interface Options {
    forceRefresh?: boolean;
}

interface OutdatedExercise {
    courseId: CourseIdentifier;
    exerciseName: string;
    exerciseId: ExerciseIdentifier;
}

/**
 * Checks all user's courses for exercise updates.
 */
// todo: mooc
export async function checkForExerciseUpdates(
    actionContext: ActionContext,
    options?: Options,
): Promise<Result<OutdatedExercise[], Error>> {
    const { langs, userData } = actionContext;
    if (!(langs.ok && userData.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    const forceRefresh = options?.forceRefresh ?? false;
    Logger.info("Checking for exercise updates, forced update:", forceRefresh);

    const tmcCheckUpdatesResult = await langs.val.checkTmcExerciseUpdates({ forceRefresh });
    if (tmcCheckUpdatesResult.err) {
        return tmcCheckUpdatesResult;
    }

    const moocCheckUpdatesResult = await langs.val.checkMoocExerciseUpdates({ forceRefresh });
    if (moocCheckUpdatesResult.err) {
        return moocCheckUpdatesResult;
    }

    const tmcUpdateableExerciseIds = new Set<number>(tmcCheckUpdatesResult.val.map((x) => x.id));
    const moocUpdateableExerciseIds = new Set<string>(moocCheckUpdatesResult.val.map((x) => x));
    const outdatedExercisesByCourse = userData.val
        .getCourses()
        .map<OutdatedExercise[]>((course) => {
            switch (course.kind) {
                case "tmc": {
                    const outdatedExercises = course.data.exercises.filter((x) =>
                        tmcUpdateableExerciseIds.has(x.id),
                    );
                    return outdatedExercises.map((x) => ({
                        courseId: CourseIdentifier.from(course.data.id),
                        exerciseId: ExerciseIdentifier.from(x.id),
                        exerciseName: x.name,
                    }));
                }
                case "mooc": {
                    const outdatedExercises = course.data.exercises.filter((x) =>
                        moocUpdateableExerciseIds.has(x.id),
                    );
                    return outdatedExercises.map((x) => ({
                        courseId: CourseIdentifier.from(course.data.instanceId),
                        exerciseId: ExerciseIdentifier.from(x.id),
                        exerciseName: x.slug,
                    }));
                }
                default: {
                    assertUnreachable(course);
                }
            }
        });
    const outdatedExercises = flatten(outdatedExercisesByCourse);
    Logger.info(`Update check found ${outdatedExercises.length} outdated exercises`);
    return Ok(outdatedExercises);
}
