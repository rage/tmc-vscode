/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that provide webviews.
 * -------------------------------------------------------------------------------------------------
 */

import { ExtensionContext } from "vscode";

import { ExerciseStatus } from "../api/workspaceManager";
import { randomPanelId, TmcPanel } from "../panels/TmcPanel";
import { Exercise } from "../shared/langsSchema";
import { ExtensionToWebview, MyCoursesPanel, Panel } from "../shared/shared";
import * as UITypes from "../ui/types";
import { dateToString, Logger, parseDate, parseNextDeadlineAfter } from "../utilities/";

import { checkForExerciseUpdates } from "./checkForExerciseUpdates";
import { ActionContext } from "./types";

/**
 * Displays a summary page of user's courses.
 */
export async function displayUserCourses(
    context: ExtensionContext,
    actionContext: ActionContext,
): Promise<void> {
    const { userData, tmc } = actionContext;
    Logger.info("Displaying My Courses view");
    if (!(userData.ok && tmc.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const panel: MyCoursesPanel = {
        type: "MyCourses",
        id: randomPanelId(),
        courseDeadlines: {},
    };

    const courses = userData.val.getCourses();
    const newExercisesCourses: ExtensionToWebview[] = courses.map((c) => ({
        type: "setNewExercises",
        target: panel,
        courseId: c.id,
        exerciseIds: c.disabled ? [] : c.newExercises,
    }));
    const disabledStatusCourses: ExtensionToWebview[] = courses.map((c) => ({
        type: "setCourseDisabledStatus",
        target: panel,
        courseId: c.id,
        disabled: c.disabled,
    }));

    TmcPanel.renderMain(context.extensionUri, context, actionContext, panel);

    TmcPanel.postMessage(...newExercisesCourses, ...disabledStatusCourses);

    const now = new Date();
    courses.forEach(async (course) => {
        const courseId = course.id;
        const exercises: Exercise[] = (await tmc.val.getCourseDetails(courseId))
            .map((x) => x.exercises)
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

        TmcPanel.postMessage({
            type: "setNextCourseDeadline",
            target: panel,
            courseId: course.id,
            deadline,
        });
    });
}

/**
 * Displays details view for a local course.
 */
export async function displayLocalCourseDetails(
    context: ExtensionContext,
    actionContext: ActionContext,
    courseId: number,
): Promise<void> {
    const { userData, workspaceManager } = actionContext;
    if (!(userData.ok && workspaceManager.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }
    const course = userData.val.getCourse(courseId);
    Logger.info(`Display course view for ${course.name}`);

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

    const exerciseData = new Map<string, UITypes.CourseDetailsExerciseGroup>();
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
        const exData = workspaceManager.val.getExerciseBySlug(course.name, ex.name);
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

    const panel: Panel = {
        type: "CourseDetails",
        id: randomPanelId(),
        courseId: course.id,
    };
    TmcPanel.renderMain(context.extensionUri, context, actionContext, panel);

    const updateablesResult = await checkForExerciseUpdates(actionContext);
    if (updateablesResult.ok) {
        TmcPanel.postMessage({
            type: "setUpdateables",
            target: panel,
            exerciseIds: updateablesResult.val.map((x) => x.exerciseId),
        });
    } else {
        Logger.warn("Failed to check for exercise updates");
    }
}
