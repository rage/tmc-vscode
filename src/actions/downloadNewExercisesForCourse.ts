import { Ok, Result } from "ts-results";

import { Logger } from "../utilities";

import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises";
import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";

/**
 * Downloads course's new exercises using relevate data from the context's UserData. Also handles
 * messages to UI and refreshing the results.
 *
 * @param courseId Course to update.
 */
export async function downloadNewExercisesForCourse(
    actionContext: ActionContext,
    courseId: number,
): Promise<Result<void, Error>> {
    const { ui, userData } = actionContext;
    const course = userData.getCourse(courseId);
    Logger.info(`Downloading new exercises for course: ${course.title}`);

    const postNewExercises = (exerciseIds: number[]): void =>
        ui.webview.postMessage({
            command: "setNewExercises",
            courseId,
            exerciseIds,
        });

    postNewExercises([]);

    const downloadResult = await downloadOrUpdateExercises(actionContext, course.newExercises);
    if (downloadResult.err) {
        Logger.error("Failed to download new exercises.", downloadResult.val);
        postNewExercises(course.newExercises);
        return downloadResult;
    }

    const refreshResult = Result.all(
        await userData.clearFromNewExercises(courseId, downloadResult.val.successful),
        await refreshLocalExercises(actionContext),
    );
    if (refreshResult.err) {
        Logger.error("Failed to refresh workspace.", downloadResult.val);
        postNewExercises(course.newExercises);
        return refreshResult;
    }

    postNewExercises(course.newExercises);

    return Ok.EMPTY;
}
