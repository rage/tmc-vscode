import * as vscode from "vscode";

import { LocalCourseData, UserData } from "../config/userdata";
import TemporaryWebview from "../ui/temporaryWebview";
import { VisibilityGroups } from "../ui/treeview/types";
import { sleep } from "../utils";
import { ActionContext } from "./types";

/**
 * Submits an exercise while keeping the user informed
 */
export async function submitExercise(id: number, { ui, resources, tmc }: ActionContext, tempView?: TemporaryWebview) {
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
        } else if (msg.setToBackground) {
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
            vscode.window.setStatusBarMessage("Tests finished, see result", 5000);
            temp.setContent("submission-result", statusData);
            break;
        }
        if (!temp.disposed) {
            temp.setContent("submission-status", statusData);
        } else {
            vscode.window.setStatusBarMessage("Waiting for results from server.", 5000);
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
    const exerciseDetails =  workspaceManager.getExerciseDataById(id);
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
    vscode.window.setStatusBarMessage(`Running tests for ${exerciseName}`);
    const testResult = await tmc.runTests(id);
    vscode.window.setStatusBarMessage("");
    if (testResult.err) {
        vscode.window.setStatusBarMessage(`Running tests for ${exerciseName} failed`, 5000);
        vscode.window.showErrorMessage(`Exercise test run failed: \
                                        ${testResult.val.name} - ${testResult.val.message}`);
        console.error(testResult.val);
        return;
    }
    vscode.window.setStatusBarMessage(`Tests finished for ${exerciseName}`, 5000);
    const testResultVal = testResult.val;
    const data = { testResultVal, id, exerciseName };
    temp.setContent("test-result", data);
}

/**
 * Prompts user to reset exercise and resets exercise if user replies to prompt correctly.
 */
export async function resetExercise(
    id: number, { tmc, workspaceManager }: ActionContext, statusBarItem: vscode.StatusBarItem,
) {
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
        statusBarItem.text = `Resetting exercise ${exerciseData.name}`;
        statusBarItem.show();
        const submitResult = await tmc.submitExercise(id);
        if (submitResult.err) {
            vscode.window.showErrorMessage(`Reset canceled, failed to submit exercise: \
                                            ${submitResult.val.name} - ${submitResult.val.message}`);
            console.error(submitResult.val);

            statusBarItem.text = `Something went wrong while resetting exercise ${exerciseData.name}`,
                setTimeout(() => {
                    statusBarItem.hide();
                }, 10000);
            statusBarItem.show();
            return;
        }
        const slug = exerciseData.organization;
        workspaceManager.deleteExercise(id);
        await tmc.downloadExercise(id, slug);

        statusBarItem.text = `Exercise ${exerciseData.name} resetted successfully`, setTimeout(() => {
            statusBarItem.hide();
        }, 10000);
        statusBarItem.show();
    } else {
        vscode.window.showInformationMessage(`Reset canceled for exercise ${exerciseData.name}.`);
    }
}

/**
 * Opens the course exercise list view
 */
export async function displayCourseDetails(id: number, { tmc, ui, userData }: ActionContext) {
    const result = await tmc.getCourseDetails(id);

    if (result.err) {
        console.error("Fetching course details failed: " + result.val.message);
        return;
    }
    const details = result.val.course;
    const organizationSlug = userData.getCourses().find((course) => course.id === id)?.organization;
    const data = {
        courseName: result.val.course.name, details,
        organizationSlug,
    };
    await ui.webview.setContentFromTemplate("course-details", data);
}

/**
 * Opens the summary view
 */
export async function displaySummary({ userData, ui }: ActionContext) {
    ui.webview.setContentFromTemplate("index", { courses: userData.getCourses() });
}

/**
 * Lets the user select a course
 */
export async function selectCourse(orgSlug: string, { tmc, resources, ui }: ActionContext) {
    const result = await tmc.getCourses(orgSlug);

    if (result.ok) {
        console.log("Courses loaded");
        const courses = result.val.sort((course1, course2) => course1.name.localeCompare(course2.name));
        const organization = (await tmc.getOrganization(orgSlug)).unwrap();
        const data = { courses, organization };
        console.log(data);
        let course: number | undefined;
        await new Promise((resolve) => {
            const temp = new TemporaryWebview(resources, ui, "Select course", (msg) => {
                course = msg.id;
                temp.dispose();
                resolve();
            });
            temp.setContent("course", data);
        });
        return course;
    } else {
        console.log("Fetching courses failed: " + result.val.message);
    }
}

/**
 * Lets the user select an organization
 */
export async function selectOrganization({ resources, tmc, ui }: ActionContext) {
    const result = await tmc.getOrganizations();
    if (result.err) {
        console.log("Fetching organizations failed: " + result.val.message);
        return;
    }
    console.log("Organizations loaded");
    const organizations = result.val.sort((org1, org2) => org1.name.localeCompare(org2.name));
    const pinned = organizations.filter((organization) => organization.pinned);
    const data = { organizations, pinned };
    let slug: string | undefined;
    await new Promise((resolve) => {
        const temp = new TemporaryWebview(resources, ui, "Select organization", (msg) => {
            slug = msg.slug;
            temp.dispose();
            resolve();
        });
        temp.setContent("organization", data);
    });
    return slug;
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

    // TODO: Pass temporary webview around to improve UX
    const organizationSlug = await selectOrganization(actionContext);
    if (!organizationSlug || organizationSlug === "") {
        return;
    }

    const courseID = await selectCourse(organizationSlug, actionContext);
    if (!courseID || courseID === -1) {
        return;
    }

    const { tmc, userData } = actionContext;
    const courseDetailsResult = await tmc.getCourseDetails(courseID);
    if (courseDetailsResult.err) {
        console.log(new Error("Fetching course data failed"));
        return;
    }

    const courseDetails = courseDetailsResult.val.course;
    const localData: LocalCourseData = {
        exerciseIds: courseDetails.exercises.map((e) => e.id), // Only IDs?
        id: courseDetails.id,
        name: courseDetails.name,
        organization: organizationSlug,
    };
    userData.addCourse(localData);
    actionContext.ui.webview.setContentFromTemplate("index", { courses: userData.getCourses() });
}
