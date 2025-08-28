import { ConnectionError, ForbiddenError } from "../errors";
import { TmcPanel } from "../panels/TmcPanel";
import { Logger } from "../utilities";
import { combineApiExerciseData } from "../utilities/apiData";
import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";
import { use } from "chai";
import { Err, Ok, Result } from "ts-results";

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
    const { exerciseDecorationProvider, tmc, userData, workspaceManager } = actionContext;
    if (!(tmc.ok && userData.ok && workspaceManager.ok && exerciseDecorationProvider.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Updating course");

    const postMessage = (courseId: number, disabled: boolean, exerciseIds: number[]): void => {
        TmcPanel.postMessage(
            {
                type: "setNewExercises",
                target: {
                    type: "MyCourses",
                },
                courseId,
                exerciseIds,
            },
            {
                type: "setCourseDisabledStatus",
                target: {
                    type: "CourseDetails",
                },
                courseId,
                disabled,
            },
        );
    };
    const courseData = userData.val.getCourse(courseId);
    const updateResult = await tmc.val.getCourseData(courseId, { forceRefresh: true });
    if (updateResult.err) {
        if (updateResult.val instanceof ForbiddenError) {
            if (!courseData.disabled) {
                Logger.warn(
                    `Failed to access information for course ${courseData.name}. Marking as disabled.`,
                );
                const course = userData.val.getCourse(courseId);
                await userData.val.updateCourse({ ...course, disabled: true });
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

    await userData.val.updateCourse({
        ...courseData,
        availablePoints,
        awardedPoints,
        description: details.description || "",
        disabled: settings.disabled_status !== "enabled",
        materialUrl: settings.material_url,
        perhapsExamMode: settings.hide_submission_results,
    });

    const updateExercisesResult = await userData.val.updateExercises(
        courseId,
        combineApiExerciseData(details.exercises, exercises),
    );
    if (updateExercisesResult.err) {
        return updateExercisesResult;
    }

    if (courseData.name === workspaceManager.val.activeCourse) {
        exerciseDecorationProvider.val.updateDecorationsForExercises(
            ...workspaceManager.val.getExercisesByCourseSlug(courseData.name),
        );
    }

    // refresh local exercises to ensure deleted exercises don't appear open etc.
    await refreshLocalExercises(actionContext);

    const course = userData.val.getCourse(courseId);
    postMessage(course.id, course.disabled, course.newExercises);

    return Ok(true);
}
