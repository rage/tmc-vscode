/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that provide webviews.
 * -------------------------------------------------------------------------------------------------
 */

import { Err, Ok, Result } from "ts-results";

import { Exercise } from "../api/types";
import { ExerciseStatus } from "../api/workspaceManager";
import TemporaryWebview from "../ui/temporaryWebview";
import * as UITypes from "../ui/types";
import { WebviewMessage } from "../ui/types";
import { dateToString, Logger, parseDate, parseNextDeadlineAfter } from "../utils/";

import { checkForExerciseUpdates } from "./checkForExerciseUpdates";
import { ActionContext } from "./types";

/**
 * Displays a summary page of user's courses.
 */
export async function displayUserCourses(actionContext: ActionContext): Promise<void> {
    const { userData, tmc, ui } = actionContext;
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

/**
 * Lets the user select a course
 */
export async function selectCourse(
    actionContext: ActionContext,
    orgSlug: string,
    webview?: TemporaryWebview,
): Promise<Result<{ changeOrg: boolean; course?: number }, Error>> {
    const { tmc, resources, ui } = actionContext;
    const result = await tmc.getCourses(orgSlug);

    if (result.err) {
        return result;
    }
    const courses = result.val.sort((course1, course2) => course1.name.localeCompare(course2.name));
    const organization = (await tmc.getOrganization(orgSlug)).unwrap();
    const data = { courses, organization };
    let changeOrg = false;
    let course: number | undefined;

    await new Promise<void>((resolve) => {
        const temp = webview || new TemporaryWebview(resources, ui);
        temp.setContent({
            title: "Select course",
            template: { templateName: "course", ...data },
            messageHandler: (msg: { type?: string; id?: number }) => {
                if (msg.type === "setCourse") {
                    course = msg.id;
                } else if (msg.type === "changeOrg") {
                    changeOrg = true;
                } else {
                    return;
                }
                if (!webview) {
                    temp.dispose();
                }
                resolve();
            },
        });
    });
    return new Ok({ changeOrg, course });
}

/**
 * Lets the user select an organization
 */
export async function selectOrganization(
    actionContext: ActionContext,
    webview?: TemporaryWebview,
): Promise<Result<string, Error>> {
    const { tmc, resources, ui } = actionContext;

    const result = await tmc.getOrganizations();
    if (result.err) {
        return result;
    }
    const organizations = result.val.sort((org1, org2) => org1.name.localeCompare(org2.name));
    const pinned = organizations.filter((organization) => organization.pinned);
    const data = { organizations, pinned };
    let slug: string | undefined;

    await new Promise<void>((resolve) => {
        const temp = webview || new TemporaryWebview(resources, ui);
        temp.setContent({
            title: "Select organization",
            template: { templateName: "organization", ...data },
            messageHandler: (msg: { type?: string; slug?: string }) => {
                if (msg.type !== "setOrganization") {
                    return;
                }
                slug = msg.slug;
                if (!webview) {
                    temp.dispose();
                }
                resolve();
            },
        });
    });
    if (!slug) {
        return new Err(new Error("Couldn't get organization"));
    }
    return new Ok(slug);
}

/**
 * Creates a new temporary webview where user can select an organization and a course.
 */
export async function selectOrganizationAndCourse(
    actionContext: ActionContext,
): Promise<Result<{ organization: string; course: number }, Error>> {
    const { resources, ui } = actionContext;

    const tempView = new TemporaryWebview(resources, ui);

    let organizationSlug: string | undefined;
    let courseId: number | undefined;

    while (!(organizationSlug && courseId)) {
        const orgResult = await selectOrganization(actionContext, tempView);
        if (orgResult.err) {
            tempView.dispose();
            return orgResult;
        }
        Logger.log(`Organization slug ${orgResult.val} selected`);
        organizationSlug = orgResult.val;
        const courseResult = await selectCourse(actionContext, organizationSlug, tempView);
        if (courseResult.err) {
            tempView.dispose();
            return courseResult;
        }
        if (courseResult.val.changeOrg) {
            continue;
        }
        courseId = courseResult.val.course;
    }
    Logger.log(`Course with id ${courseId} selected`);
    tempView.dispose();
    return new Ok({ organization: organizationSlug, course: courseId });
}
