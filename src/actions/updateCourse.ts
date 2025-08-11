import { Err, Ok, Result } from "ts-results";

import { ConnectionError, ForbiddenError } from "../errors";
import { TmcPanel } from "../panels/TmcPanel";
import {
    CourseIdentifier,
    Enum,
    ExerciseIdentifier,
    LocalCourseData,
    makeMoocKind,
    makeTmcKind,
    match,
} from "../shared/shared";
import { Logger } from "../utilities";
import { combineTmcApiExerciseData } from "../utilities/apiData";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";
import { CombinedCourseData, CourseInstance, TmcExerciseSlide } from "../shared/langsSchema";

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * @param courseId ID of the course to update.
 * @returns Boolean value representing whether the data from server was successfully received.
 */
export async function updateCourse(
    actionContext: ActionContext,
    courseId: CourseIdentifier,
): Promise<Result<boolean, Error>> {
    const { exerciseDecorationProvider, langs, userData, workspaceManager } = actionContext;
    if (!(langs.ok && userData.ok && workspaceManager.ok && exerciseDecorationProvider.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Updating course");

    const postMessage = (
        courseId: CourseIdentifier,
        disabled: boolean,
        exerciseIds: ExerciseIdentifier[],
    ): void => {
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
    const updateResult: Result<
        Enum<CombinedCourseData, [CourseInstance, Array<TmcExerciseSlide>]>,
        Error
    > = await match(
        courseId,
        (tmcId) =>
            langs.val
                .getTmcCourseData(tmcId.courseId, { forceRefresh: true })
                .then((res) => res.map(makeTmcKind)),
        (moocId) =>
            langs.val
                .getMoocCourseInstanceData(moocId.instanceId)
                .then((res) => res.map(makeMoocKind)),
    );
    if (updateResult.err) {
        if (updateResult.val instanceof ForbiddenError) {
            const course = userData.val.getCourse(courseId);
            const courseIdent = LocalCourseData.getCourseId(course);
            if (!courseData.data.disabled) {
                Logger.warn(`Failed to access information for course. Marking as disabled.`);
                course.data.disabled = true;
                await userData.val.updateCourse(course);
                postMessage(courseIdent, true, []);
            } else {
                Logger.warn(`ForbiddenError above probably caused by course still being disabled`);
                postMessage(courseIdent, true, []);
            }
            return Ok(false);
        } else if (updateResult.val instanceof ConnectionError) {
            Logger.warn("Failed to fetch data from TMC servers, data not updated.");
            return Ok(false);
        } else {
            return updateResult;
        }
    }

    const updateExercisesResult = await match(
        updateResult.val,
        async (tmc) => {
            const { details, exercises, settings } = tmc;
            const [availablePoints, awardedPoints] = exercises.reduce(
                (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
                [0, 0],
            );

            courseData.data = {
                ...courseData.data,
                availablePoints,
                awardedPoints,
                description: details.description || "",
                disabled: settings.disabled_status !== "enabled",
                materialUrl: settings.material_url,
                perhapsExamMode: settings.hide_submission_results,
            };
            await userData.val.updateCourse(courseData);

            return await userData.val.updateExercises(
                courseId,
                combineTmcApiExerciseData(details.exercises, exercises).map(makeTmcKind),
            );
        },
        async (mooc) => {
            const [_courseInstance, slides] = mooc;
            const localExercises = slides
                .flatMap((s) =>
                    s.tasks.map((t) => ({
                        id: t.task_id,
                        slug: s.exercise_name,
                        deadline: s.deadline,
                        passed: false,
                        softDeadline: s.deadline,
                    })),
                )
                .map(makeMoocKind);
            return await userData.val.updateExercises(courseId, localExercises);
        },
    );
    if (updateExercisesResult.err) {
        return updateExercisesResult;
    }

    const courseName = LocalCourseData.getCourseName(courseData);
    if (courseName === workspaceManager.val.activeCourse) {
        exerciseDecorationProvider.val.updateDecorationsForExercises(
            ...workspaceManager.val.getExercisesByCourseSlug(courseName),
        );
    }

    // refresh local exercises to ensure deleted exercises don't appear open etc.
    await refreshLocalExercises(actionContext);

    const course = userData.val.getCourse(courseId);
    postMessage(
        LocalCourseData.getCourseId(course),
        course.data.disabled,
        LocalCourseData.getNewExercises(course),
    );

    return Ok(true);
}
