/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group of actions that provide webviews.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import * as vscode from "vscode";

import { Err, Ok, Result } from "ts-results";
import TemporaryWebview from "../ui/temporaryWebview";
import { parseDeadline } from "../utils";
import { ActionContext } from "./types";

/**
 * Displays a summary page of user's courses.
 */
export async function displayUserCourses({ userData, ui }: ActionContext) {
    ui.webview.setContentFromTemplate("index", { courses: userData.getCourses() });
}

/**
 * Displays details view for a local course.
 */
export async function displayLocalCourseDetails(courseId: number, actionContext: ActionContext) {
    const { ui, userData, workspaceManager } = actionContext;
    const course = userData.getCourse(courseId);
    const workspaceExercises = workspaceManager.getExercisesByCourseName(course.name);

    // If no exercises downloaded, skip straight to downloading - DISABLED FOR NOW
    /* if (workspaceExercises.length === 0) {
        return displayCourseDownloadDetails(courseId, actionContext);
    } */

    const exerciseData = new Map<number, {
        id: number, name: string, isOpen: boolean,
        passed: boolean, deadlineString: string,
    }>();

    workspaceExercises?.forEach((x) => exerciseData.set(x.id, {
        deadlineString: x.deadline ? parseDeadline(x.deadline).toString().split("(", 1)[0] : "-",
        id: x.id, isOpen: x.isOpen, name: x.name, passed: false,
    }));

    course.exercises.forEach((x) => {
        const data = exerciseData.get(x.id);
        if (data) {
            data.passed = x.passed;
            exerciseData.set(x.id, data);
        }
    });

    const sortedExercises = Array.from(exerciseData.values()).sort((a, b) => (a.deadlineString === b.deadlineString)
        ? a.name.localeCompare(b.name)
        : a.deadlineString.localeCompare(b.deadlineString),
    );

    ui.webview
        .setContentFromTemplate("course-details", { exerciseData: sortedExercises, course, courseId: course.id }, true);
}

/**
 * Lets the user select a course
 */
export async function selectCourse(orgSlug: string, { tmc, resources, ui }: ActionContext, webview?: TemporaryWebview):
    Promise<Result<{ changeOrg: boolean, course?: number }, Error>> {
    const result = await tmc.getCourses(orgSlug);

    if (result.err) {
        return new Err(result.val);
    }
    const courses = result.val.sort((course1, course2) => course1.name.localeCompare(course2.name));
    const organization = (await tmc.getOrganization(orgSlug)).unwrap();
    const data = { courses, organization };
    let changeOrg = false;
    let course: number | undefined;

    await new Promise((resolve) => {
        const temp = webview ? webview : new TemporaryWebview(resources, ui, "", () => { });
        temp.setTitle("Select course");
        temp.setMessageHandler((msg: { type: string, id: number }) => {
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
        });
        temp.setContent("course", data);
    });
    return new Ok({ changeOrg, course });
}

/**
 * Lets the user select an organization
 */
export async function selectOrganization({ resources, tmc, ui }: ActionContext, webview?: TemporaryWebview):
    Promise<Result<string, Error>> {
    const result = await tmc.getOrganizations();
    if (result.err) {
        return new Err(result.val);
    }
    const organizations = result.val.sort((org1, org2) => org1.name.localeCompare(org2.name));
    const pinned = organizations.filter((organization) => organization.pinned);
    const data = { organizations, pinned };
    let slug: string | undefined;

    await new Promise((resolve) => {
        const temp = webview ? webview : new TemporaryWebview(resources, ui, "", () => { });
        temp.setTitle("Select organization");
        temp.setMessageHandler((msg: { type: string, slug: string }) => {
            if (msg.type !== "setOrganization") {
                return;
            }
            slug = msg.slug;
            if (!webview) {
                temp.dispose();
            }
            resolve();
        });
        temp.setContent("organization", data);
    });
    if (!slug) {
        return new Err(new Error("Couldn't get organization"));
    }
    return new Ok(slug);
}

/**
 * Creates a new temporary webview where user can select an organization and a course.
 */
export async function selectOrganizationAndCourse(actionContext: ActionContext):
    Promise<Result<{ organization: string, course: number }, Error>> {

    const tempView = new TemporaryWebview(actionContext.resources, actionContext.ui, "", () => { });

    let organizationSlug: string | undefined;
    let courseID: number | undefined;

    while (!(organizationSlug && courseID)) {
        const orgResult = await selectOrganization(actionContext, tempView);
        if (orgResult.err) {
            tempView.dispose();
            return new Err(orgResult.val);
        }
        organizationSlug = orgResult.val;
        const courseResult = await selectCourse(organizationSlug, actionContext, tempView);
        if (courseResult.err) {
            tempView.dispose();
            return new Err(courseResult.val);
        }
        if (courseResult.val.changeOrg) {
            continue;
        }
        courseID = courseResult.val.course;
    }

    tempView.dispose();
    return new Ok({ organization: organizationSlug, course: courseID });
}

/**
 * Displays the course exercise list view
 */
export async function displayCourseDownloads(
    courseId: number, { tmc, ui, userData, workspaceManager }: ActionContext) {
    const result = await tmc.getCourseDetails(courseId);
    if (result.err) {
        vscode.window.showErrorMessage(`Cannot display download details for course: \
                                        ${result.val.name} - ${result.val.message}`);
        return;
    }
    const details = result.val.course;
    userData.updateCompletedExercises(courseId, details.exercises.filter((x) => x.completed).map((x) => x.id));

    const organizationSlug = userData.getCourses().find((course) => course.id === courseId)?.organization;
    const exerciseDetails = details.exercises.map((x) =>
        ({ exercise: x, downloaded: workspaceManager.getExerciseDataById(x.id).ok }));
    const sortedExercises = exerciseDetails.sort((x, y) => {
        return (x.downloaded === y.downloaded) ? 0 : x.downloaded ? 1 : -1;
    });
    const workspaceEmpty = workspaceManager.getExercisesByCourseName(details.name).length === 0;
    const data = {
        courseId, courseName: result.val.course.name, details, sortedExercises, organizationSlug, workspaceEmpty,
    };
    await ui.webview.setContentFromTemplate("download-exercises", data);
}
