/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that provide webviews.
 * -------------------------------------------------------------------------------------------------
 */

import du = require("du");

import { Exercise } from "../api/types";
import { ExerciseStatus } from "../api/workspaceManager";
import * as UITypes from "../ui/types";
import { WebviewMessage } from "../ui/types";
import {
    dateToString,
    formatSizeInBytes,
    Logger,
    parseDate,
    parseNextDeadlineAfter,
} from "../utils/";

import { checkForExerciseUpdates } from "./checkForExerciseUpdates";
import { ActionContext } from "./types";

/**
 * Displays a summary page of user's courses.
 */
export async function displayUserCourses(actionContext: ActionContext): Promise<void> {
    const { userData, tmc, ui, resources } = actionContext;
    Logger.log("Displaying My Courses view");

    const courses = userData.getCourses();
    const newExercisesCourses: WebviewMessage[] = courses.map((c) => ({
        command: "setNewExercises",
        courseId: c.id,
        exerciseIds: c.disabled ? [] : c.newExercises,
    }));
    const disabledStatusCourses: WebviewMessage[] = courses.map((c) => ({
        command: "setCourseDisabledStatus",
        courseId: c.id,
        disabled: c.disabled,
    }));

    ui.webview.setContentFromTemplate({ templateName: "my-courses", courses }, false, [
        ...newExercisesCourses,
        ...disabledStatusCourses,
        {
            command: "setTmcDataFolder",
            diskSize: formatSizeInBytes(await du(resources.projectsDirectory)),
            path: resources.projectsDirectory,
        },
    ]);

    const now = new Date();
    courses.forEach(async (course) => {
        const courseId = course.id;
        const exercises: Exercise[] = (await tmc.getCourseDetails(courseId))
            .map((x) => x.course.exercises)
            .unwrapOr([]);

        const deadline = parseNextDeadlineAfter(
            now,
            exercises.map((x) => {
                const softDeadline = x.soft_deadline ? parseDate(x.soft_deadline) : null;
                const hardDeadline = x.deadline ? parseDate(x.deadline) : null;
                return {
                    active: true,
                    date: (softDeadline && hardDeadline ? hardDeadline <= softDeadline : true)
                        ? hardDeadline
                        : softDeadline,
                };
            }) || [],
        );

        ui.webview.postMessage({ command: "setNextCourseDeadline", courseId, deadline });
    });
}

/**
 * Displays details view for a local course.
 */
export async function displayLocalCourseDetails(
    actionContext: ActionContext,
    courseId: number,
): Promise<void> {
    const { ui, tmc, userData, workspaceManager } = actionContext;

    const mapStatus = (
        exerciseId: number,
        status: ExerciseStatus,
        expired: boolean,
    ): UITypes.ExerciseStatus => {
        switch (status) {
            case ExerciseStatus.Closed:
                return "closed";
            case ExerciseStatus.Open:
                return "opened";
            default:
                return expired ? "expired" : "new";
        }
    };

    const course = userData.getCourse(courseId);
    Logger.log(`Display course view for ${course.name}`);

    const exerciseData = new Map<string, UITypes.CourseDetailsExerciseGroup>();
    const apiCourse = (await tmc.getCourseDetails(courseId)).mapErr(() => undefined).val?.course;
    const currentDate = new Date();

    const initialState: UITypes.WebviewMessage[] = [
        {
            command: "setCourseDisabledStatus",
            courseId: course.id,
            disabled: course.disabled,
        },
    ];
    course.exercises.forEach((ex) => {
        const nameMatch = ex.name.match(/(\w+)-(.+)/);
        const groupName = nameMatch?.[1] || "";
        const group = exerciseData.get(groupName);
        const name = nameMatch?.[2] || "";
        const exData = workspaceManager.getExerciseBySlug(course.name, ex.name);
        const softDeadline = ex.softDeadline ? parseDate(ex.softDeadline) : null;
        const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null;
        initialState.push({
            command: "exerciseStatusChange",
            exerciseId: ex.id,
            status: mapStatus(
                ex.id,
                exData?.status ?? ExerciseStatus.Missing,
                hardDeadline !== null && currentDate >= hardDeadline,
            ),
        });
        const entry: UITypes.CourseDetailsExercise = {
            id: ex.id,
            name,
            passed: course.exercises.find((ce) => ce.id === ex.id)?.passed || false,
            softDeadline,
            softDeadlineString: softDeadline ? dateToString(softDeadline) : "-",
            hardDeadline,
            hardDeadlineString: hardDeadline ? dateToString(hardDeadline) : "-",
            isHard: softDeadline && hardDeadline ? hardDeadline <= softDeadline : true,
        };

        exerciseData.set(groupName, {
            name: groupName,
            nextDeadlineString: "",
            exercises: group?.exercises.concat(entry) || [entry],
        });
    });

    const offlineMode = apiCourse === undefined;
    const courseGroups = Array.from(exerciseData.values())
        .sort((a, b) => (a.name > b.name ? 1 : -1))
        .map((e) => {
            return {
                ...e,
                exercises: e.exercises.sort((a, b) => (a.name > b.name ? 1 : -1)),
                nextDeadlineString: offlineMode
                    ? "Next deadline: Not available"
                    : parseNextDeadlineAfter(
                          currentDate,
                          e.exercises.map((ex) => ({
                              date: ex.isHard ? ex.hardDeadline : ex.softDeadline,
                              active: !ex.passed,
                          })),
                      ),
            };
        });

    await ui.webview.setContentFromTemplate(
        {
            templateName: "course-details",
            exerciseData: courseGroups,
            course,
            courseId: course.id,
            offlineMode,
        },
        true,
        initialState,
    );

    const updateablesResult = await checkForExerciseUpdates(actionContext);
    if (updateablesResult.ok) {
        ui.webview.postMessage({
            command: "setUpdateables",
            exerciseIds: updateablesResult.val.map((x) => x.exerciseId),
            courseId,
        });
    } else {
        Logger.warn("Failed to check for exercise updates");
    }
}
