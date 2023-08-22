import { Ok, Result } from "ts-results";

import { ConnectionError, ForbiddenError } from "../errors";
import { Logger } from "../utilities";
import { combineApiExerciseData } from "../utilities/apiData";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * @param courseId ID of the course to update.
 * @returns Boolean value representing whether the data from server was successfully received.
 */
export async function updateCourse(
    actionContext: ActionContext,
    courseId: number,
): Promise<Result<boolean, Error>> {
    const { exerciseDecorationProvider, tmc, ui, userData, workspaceManager } = actionContext;
    Logger.info("Updating course");

    const postMessage = (courseId: number, disabled: boolean, exerciseIds: number[]): void => {
        ui.webview.postMessage(
            {
                command: "setNewExercises",
                courseId,
                exerciseIds,
            },
            {
                command: "setCourseDisabledStatus",
                courseId,
                disabled,
            },
        );
    };
    const courseData = userData.getCourse(courseId);
    const updateResult = await tmc.getCourseData(courseId, { forceRefresh: true });
    if (updateResult.err) {
        if (updateResult.val instanceof ForbiddenError) {
            if (!courseData.disabled) {
                Logger.warn(
                    `Failed to access information for course ${courseData.name}. Marking as disabled.`,
                );
                const course = userData.getCourse(courseId);
                await userData.updateCourse({ ...course, disabled: true });
                postMessage(course.id, true, []);
            } else {
                Logger.warn(
                    `ForbiddenError above probably caused by course still being disabled ${courseData.name}`,
                );
                postMessage(courseData.id, true, []);
            }
            return Ok(false);
        } else if (updateResult.val instanceof ConnectionError) {
            Logger.warn("Failed to fetch data from TMC servers, data not updated.");
            return Ok(false);
        } else {
            return updateResult;
        }
    }

    const { details, exercises, settings } = updateResult.val;
    const [availablePoints, awardedPoints] = exercises.reduce(
        (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
        [0, 0],
    );

    await userData.updateCourse({
        ...courseData,
        availablePoints,
        awardedPoints,
        description: details.description || "",
        disabled: settings.disabled_status !== "enabled",
        materialUrl: settings.material_url,
        perhapsExamMode: settings.hide_submission_results,
    });

    const updateExercisesResult = await userData.updateExercises(
        courseId,
        combineApiExerciseData(details.exercises, exercises),
    );
    if (updateExercisesResult.err) {
        return updateExercisesResult;
    }

    if (courseData.name === workspaceManager.activeCourse) {
        exerciseDecorationProvider.updateDecorationsForExercises(
            ...workspaceManager.getExercisesByCourseSlug(courseData.name),
        );
    }

    // refresh local exercises to ensure deleted exercises don't appear open etc.
    await refreshLocalExercises(actionContext);

    const course = userData.getCourse(courseId);
    postMessage(course.id, course.disabled, course.newExercises);

    return Ok(true);
}
