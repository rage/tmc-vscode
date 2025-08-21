/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that provide webviews.
 * -------------------------------------------------------------------------------------------------
 */

import { ExtensionContext } from "vscode";

import { ExerciseStatus } from "../api/workspaceManager";
import { randomPanelId, TmcPanel } from "../panels/TmcPanel";
import { Exercise } from "../shared/langsSchema";
import {
    ExerciseIdentifier,
    ExtensionToWebview,
    makeMoocKind,
    makeTmcKind,
    MyCoursesPanel,
    Panel,
    LocalCourseData,
    CourseIdentifier,
    match,
} from "../shared/shared";
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
    const { userData, langs } = actionContext;
    Logger.info("Displaying My Courses view");
    if (!(userData.ok && langs.ok)) {
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
        courseId: LocalCourseData.getCourseId(c),
        exerciseIds: c.data.disabled ? [] : c.data.newExercises.map(ExerciseIdentifier.from),
    }));
    const disabledStatusCourses: ExtensionToWebview[] = courses.map((c) => ({
        type: "setCourseDisabledStatus",
        target: panel,
        courseId: LocalCourseData.getCourseId(c),
        disabled: c.data.disabled,
    }));

    TmcPanel.renderMain(context.extensionUri, context, actionContext, panel);

    TmcPanel.postMessage(...newExercisesCourses, ...disabledStatusCourses);

    const now = new Date();
    courses.forEach(async (course) => {
        const courseId = LocalCourseData.getCourseId(course);
        const exercises: Exercise[] = (await langs.val.getCourseDetails(courseId))
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
            courseId: LocalCourseData.getCourseId(course),
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
    courseId: CourseIdentifier,
): Promise<void> {
    const { userData, workspaceManager } = actionContext;
    if (!(userData.ok && workspaceManager.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }
    const course = userData.val.getCourse(courseId);
    Logger.info(`Display course view for ${LocalCourseData.getCourseName(course)}`);

    const mapStatus = (
        exerciseId: ExerciseIdentifier,
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
            courseId,
            disabled: match(
                course,
                (tmc) => tmc.disabled,
                (mooc) => mooc.disabled,
            ),
        },
    ];
    match(
        course,
        (tmc) =>
            tmc.exercises.forEach((ex) => {
                const nameMatch = ex.name.match(/(\w+)-(.+)/);
                const groupName = nameMatch?.[1] || "";
                const group = exerciseData.get(groupName);
                const name = nameMatch?.[2] || "";
                const exData = workspaceManager.val.getExerciseBySlug(
                    "tmc",
                    LocalCourseData.getCourseName(course),
                    ex.name,
                );
                const softDeadline = ex.softDeadline ? parseDate(ex.softDeadline) : null;
                const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null;
                initialState.push({
                    command: "exerciseStatusChange",
                    exerciseId: ex.id,
                    status: mapStatus(
                        makeTmcKind({ tmcExerciseId: ex.id }),
                        exData?.status ?? ExerciseStatus.Missing,
                        hardDeadline !== null && currentDate >= hardDeadline,
                    ),
                });
                const entry: UITypes.CourseDetailsExercise = {
                    id: makeTmcKind({ tmcExerciseId: ex.id }),
                    name,
                    passed: tmc.exercises.find((ce) => ce.id === ex.id)?.passed || false,
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
            }),
        (mooc) => {},
    );

    const panel: Panel = {
        type: "CourseDetails",
        id: randomPanelId(),
        courseId,
        exerciseGroups: [],
        exerciseStatuses: {
            tmc: {},
            mooc: {},
        },
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
