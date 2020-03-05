import { Err, Ok, Result, Results } from "ts-results";
import * as vscode from "vscode";

import { LocalCourseData, UserData } from "../config/userdata";
import TemporaryWebview from "../ui/temporaryWebview";
import { VisibilityGroups } from "../ui/treeview/types";
import { parseDeadline, sleep } from "../utils";
import { ActionContext } from "./types";

/**
 * Submits an exercise while keeping the user informed
 */
export async function submitExercise(id: number,
                                     { userData, ui, resources, tmc, workspaceManager }: ActionContext,
                                     tempView?: TemporaryWebview) {
    const submitResult = await tmc.submitExercise(id);
    if (submitResult.err) {
        vscode.window.showErrorMessage(`Exercise submission failed: \
                                        ${submitResult.val.name} - ${submitResult.val.message}`);
        console.error(submitResult.val);
        return;
    }

    const messageHandler = async (msg: any) => {
        if (msg.feedback && msg.feedback.status.length > 0) {
            console.log(await tmc.submitSubmissionFeedback(msg.url, msg.feedback));
        } else if (msg.runInBackground) {
            ui.setStatusBar("Waiting for results from server.");
            temp.dispose();
        } else if (msg.showInBrowser) {
            vscode.env.openExternal(vscode.Uri.parse(submitResult.val.show_submission_url));
        } else if (msg.showSolutionInBrowser) {
            vscode.env.openExternal(vscode.Uri.parse(msg.solutionUrl));
        }
    };

    if (tempView !== undefined) {
        tempView.setMessageHandler(messageHandler);
        tempView.setTitle("TMC Server Submission");
    }

    const temp =
        tempView !== undefined ?
            tempView :
            new TemporaryWebview(resources, ui, "TMC Server Submission", messageHandler);

    let timeWaited = 0;
    let getStatus = true;
    while (getStatus) {
        const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
        if (statusResult.err) {
            console.error(statusResult.val);
            break;
        }
        const statusData = statusResult.val;
        if (statusResult.val.status !== "processing") {
            ui.setStatusBar("Tests finished, see result", 5000);
            temp.setContent("submission-result", statusData);
            if (statusData.status === "ok") {
                userData.setPassed(
                    userData.getCourseByName(workspaceManager.getExerciseDataById(id).unwrap().course).id
                    , id);
            }
            break;
        }
        if (!temp.disposed) {
            temp.setContent("submission-status", statusData);
        }
        await sleep(2500);
        timeWaited = timeWaited + 2500;

        if (timeWaited === 120000) {
            vscode.window.showInformationMessage(`This seems to be taking a long time — consider continuing to the next exercise while this is running. \
            Your submission will still be graded. Check the results later at ${submitResult.val.show_submission_url}`,
                ...["Open URL and move on...", "No, I'll wait"])
                .then((selection) => {
                    if (selection === "Open URL and move on...") {
                        vscode.env.openExternal(
                            vscode.Uri.parse(submitResult.val.show_submission_url));
                        getStatus = false;
                        temp.dispose();
                    }
                });
        }
    }
}

/**
 * Tests an exercise while keeping the user informed
 */
export async function testExercise(id: number, actions: ActionContext) {
    const { ui, resources, tmc, workspaceManager } = actions;
    const exerciseDetails = workspaceManager.getExerciseDataById(id);
    if (exerciseDetails.err) {
        vscode.window.showErrorMessage(`Getting exercise details failed: ${exerciseDetails.val.name} - ${exerciseDetails.val.message}`);
        console.error(exerciseDetails.val);
        return;
    }
    const exerciseName = exerciseDetails.val.name;
    const temp = new TemporaryWebview(resources, ui,
        "TMC Test Results", async (msg) => {
            if (msg.setToBackground) {
                temp.dispose();
            }
            if (msg.submit) {
                submitExercise(msg.exerciseId, actions, temp);
            }
        });
    temp.setContent("running-tests", { exerciseName });
    ui.setStatusBar(`Running tests for ${exerciseName}`);
    const testResult = await tmc.runTests(id);
    if (testResult.err) {
        ui.setStatusBar(`Running tests for ${exerciseName} failed`, 5000);
        vscode.window.showErrorMessage(`Exercise test run failed: \
                                        ${testResult.val.name} - ${testResult.val.message}`);
        console.error(testResult.val);
        return;
    }
    ui.setStatusBar(`Tests finished for ${exerciseName}`, 5000);
    const testResultVal = testResult.val;
    const data = { testResultVal, id, exerciseName };
    temp.setContent("test-result", data);
}

/**
 * Prompts user to reset exercise and resets exercise if user replies to prompt correctly.
 */
export async function resetExercise(id: number, { ui, tmc, workspaceManager }: ActionContext) {
    const exerciseData = workspaceManager.getExerciseDataById(id).unwrap();
    const options: vscode.InputBoxOptions = {
        placeHolder: "Write 'Yes' to confirm or 'No' to cancel and press 'Enter'.",
        prompt: `Are you sure you want to reset exercise ${exerciseData.name} ? `,
    };
    const reset = await vscode.window.showInputBox(options).then((value) => {
        if (value?.toLowerCase() === "yes") {
            return true;
        } else {
            return false;
        }
    });

    if (reset) {
        vscode.window.showInformationMessage(`Resetting exercise ${exerciseData.name}`);
        ui.setStatusBar(`Resetting exercise ${exerciseData.name}`);
        const submitResult = await tmc.submitExercise(id);
        if (submitResult.err) {
            vscode.window.showErrorMessage(`Reset canceled, failed to submit exercise: \
                                            ${submitResult.val.name} - ${submitResult.val.message}`);
            console.error(submitResult.val);
            ui.setStatusBar(`Something went wrong while resetting exercise ${exerciseData.name}`, 10000);
            return;
        }
        const slug = exerciseData.organization;
        workspaceManager.deleteExercise(id);
        await tmc.downloadExercise(id, slug, true);
        ui.setStatusBar(`Exercise ${exerciseData.name} resetted successfully`, 10000);
    } else {
        vscode.window.showInformationMessage(`Reset canceled for exercise ${exerciseData.name}.`);
    }
}

/**
 * Opens the course exercise list view
 */
export async function displayCourseDownloadDetails(id: number, { tmc, ui, userData }: ActionContext) {
    const result = await tmc.getCourseDetails(id);

    if (result.err) {
        console.error("Fetching course details failed: " + result.val.message);
        return;
    }
    const details = result.val.course;
    userData.updateCompletedExercises(id, details.exercises.filter((x) => x.completed).map((x) => x.id));

    const organizationSlug = userData.getCourses().find((course) => course.id === id)?.organization;
    const data = {
        courseId: id, courseName: result.val.course.name, details, organizationSlug,
    };
    await ui.webview.setContentFromTemplate("download-exercises", data);
}

/**
 * Opens details view for local exercises
 */
export async function displayLocalExerciseDetails(id: number, { tmc, ui, userData, workspaceManager }: ActionContext) {
    const course = userData.getCourse(id);
    const exercises = workspaceManager.getExercisesByCourseName(course.name);
    const exerciseData = new Map<number, { id: number, name: string, isOpen: boolean,
                                        passed: boolean, deadlineString: string }>();

    exercises?.forEach((x) => exerciseData.set(x.id,
    { deadlineString: x.deadline ? parseDeadline(x.deadline).toString().split("(", 1)[0] : "-",
    id: x.id, isOpen: x.isOpen, name: x.name, passed: false }));

    course.exercises.forEach((x) => {
        const data = exerciseData.get(x.id);
        if (data) {
            data.passed = x.passed;
            exerciseData.set(x.id, data);
        }
    });

    const sortedExercises = Array.from(exerciseData.values()).sort((a, b) => {
        if (a.deadlineString === b.deadlineString) {
            return a.name.localeCompare(b.name);
        }
        return a.deadlineString.localeCompare(b.deadlineString);
    });

    ui.webview.setContentFromTemplate("course-details",
    { exerciseData: sortedExercises, course, courseId: course.id }, true);
}

/**
 * Opens the summary view
 */
export async function displaySummary({ userData, ui }: ActionContext) {
    ui.webview.setContentFromTemplate("index", { courses: userData.getCourses() });
}

/**
 * Returns a handler that downloads given exercises and opens them in VSCode explorer, when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param tmc TMC API instance used for downloading exercises
 */
export async function downloadExercises(
    actionContext: ActionContext, ids: number[], organizationSlug: string, courseName: string, courseId: number) {
    const { tmc, ui } = actionContext;
    ui.webview.setContentFromTemplate("loading");
    const results = Results(...await Promise.all(ids.map(
        (x) => tmc.downloadExercise(x, organizationSlug))));

    if (results.err) {
        vscode.window.showErrorMessage("One or more exercise downloads failed.");
    }

    await displayLocalExerciseDetails(courseId, actionContext);
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
 * Authenticates and logs the user in of credentials are correct.
 */
export async function login(
    actionContext: ActionContext,
    username: string,
    password: string,
    visibilityGroups: VisibilityGroups,
) {
    const wrapError = (error: string) => `<div class="alert alert-danger fade show" role="alert">${error}</div>`;

    const { tmc, ui } = actionContext;
    if (!username || !password) {
        ui.webview.setContentFromTemplate("login",
            { error: wrapError("Username and password may not be empty.") }, true);
        return;
    }
    const result = await tmc.authenticate(username, password);
    if (result.ok) {
        ui.treeDP.updateVisibility([visibilityGroups.LOGGED_IN]);
        displaySummary(actionContext);
    } else {
        console.log("Login failed: " + result.val.message);
        ui.webview.setContentFromTemplate("login", { error: wrapError(result.val.message) }, true);
    }
}

/**
 * Logs the user out, updating UI state
 */
export function logout(visibility: VisibilityGroups, { tmc, ui }: ActionContext) {
    tmc.deauthenticate();
    ui.webview.dispose();
    ui.treeDP.updateVisibility([visibility.LOGGED_IN.not]);
}

export async function selectNewCourse(actionContext: ActionContext) {

    const orgAndCourse = await selectOrganizationAndCourse(actionContext);
    if (orgAndCourse.err) {
        return;
    }

    const { tmc, userData } = actionContext;
    const courseDetailsResult = await tmc.getCourseDetails(orgAndCourse.val.course);
    if (courseDetailsResult.err) {
        console.log(new Error("Fetching course data failed"));
        return;
    }

    const courseDetails = courseDetailsResult.val.course;

    const localData: LocalCourseData = {
        description: courseDetails.description,
        exercises: courseDetails.exercises.map((e) => ({ id: e.id, passed: e.completed })),
        id: courseDetails.id,
        name: courseDetails.name,
        organization: orgAndCourse.val.organization,
    };
    userData.addCourse(localData);
    actionContext.ui.webview.setContentFromTemplate("index", { courses: userData.getCourses() });
}

export async function openExercises(ids: number[], actionContext: ActionContext) {
    ids.forEach((id) => actionContext.workspaceManager.openExercise(id));
}

export async function closeExercises(ids: number[], actionContext: ActionContext) {
    ids.forEach((id) => actionContext.workspaceManager.closeExercise(id));
}

export async function closeCompletedExercises(courseId: number, actionContext: ActionContext) {
    const courseData = actionContext.userData.getCourses().find((x) => x.id === courseId);
    if (!courseData) {
        return;
    }
    closeExercises(courseData.exercises.filter((x) => x.passed).map((x) => x.id), actionContext);
}

export async function openUncompletedExercises(courseId: number, actionContext: ActionContext) {
    const courseData = actionContext.userData.getCourses().find((x) => x.id === courseId);
    console.log(courseId);
    console.log(courseData);
    if (!courseData) {
        return;
    }
    openExercises(courseData.exercises.filter((x) => !x.passed).map((x) => x.id), actionContext);
}
