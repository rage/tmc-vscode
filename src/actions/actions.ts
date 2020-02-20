import * as vscode from "vscode";

import Storage from "../config/storage";
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
    const { ui, resources, tmc } = actions;
    const exerciseDetails = await tmc.getExerciseDetails(id);
    if (exerciseDetails.err) {
        vscode.window.showErrorMessage(`Getting exercise details failed: ${exerciseDetails.val.name} - ${exerciseDetails.val.message}`);
        console.error(exerciseDetails.val);
        return;
    }
    const exerciseName = exerciseDetails.val.exercise_name;
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

export async function resetExercise(
    id: number, { tmc, exerciseManager }: ActionContext, statusBarItem: vscode.StatusBarItem,
) {
    vscode.window.showInformationMessage("Resetting exercise...");
    statusBarItem.text = `resetting exercise`;
    statusBarItem.show();
    const submitResult = await tmc.submitExercise(id);
    if (submitResult.err) {
        vscode.window.showErrorMessage(`Reset canceled, failed to submit exercise: \
                                        ${submitResult.val.name} - ${submitResult.val.message}`);
        console.error(submitResult.val);

        statusBarItem.text = `Something went wrong`, setTimeout(() => {
            statusBarItem.hide();
        }, 5000);
        statusBarItem.show();
        return;
    }
    const slug = exerciseManager.getOrganizationSlugByExerciseId(id);
    exerciseManager.deleteExercise(id);
    await tmc.downloadExercise(id, slug.unwrap());

    statusBarItem.text = `Exercise resetted successfully`, setTimeout(() => {
        statusBarItem.hide();
    }, 5000);
    statusBarItem.show();
}

/**
 * Opens the organization course list view
 */
export async function displayCourses(storage: Storage, { tmc, ui }: ActionContext) {
    const result = await tmc.getCourses();
    const slug = storage.getOrganizationSlug();

    if (slug === undefined) {
        return;
    }
    const resultOrg = await tmc.getOrganization(slug);

    if (result.ok) {
        console.log("Courses loaded");
        const courses = result.val.sort((course1, course2) => course1.name.localeCompare(course2.name));
        const organization = resultOrg.val;
        const data = { courses, organization };
        await ui.webview.setContentFromTemplate("course", data);
    } else {
        console.log("Fetching courses failed: " + result.val.message);
    }
}

/**
 * Opens the course exercise list view
 */
export async function displayCourseDetails(id: number, storage: Storage, { tmc, ui }: ActionContext) {
    const result = await tmc.getCourseDetails(id);

    if (result.err) {
        console.error("Fetching course details failed: " + result.val.message);
        return;
    }
    const details = result.val.course;
    const data = {
        courseName: result.val.course.name, details,
        organizationSlug: storage.getOrganizationSlug(),
    };
    await ui.webview.setContentFromTemplate("course-details", data);
}

/**
 * Opens the summary view
 */
export async function displaySummary({ ui }: ActionContext) {
    // TODO: Have something to display on summary.
    await ui.webview.setContentFromTemplate("index");
}

/**
 * Opens the organization list view
 */
export async function displayOrganizations({ tmc, ui }: ActionContext) {
    const result = await tmc.getOrganizations();
    if (result.err) {
        console.log("Fetching organizations failed: " + result.val.message);
        return;
    }
    console.log("Organizations loaded");
    const organizations = result.val.sort((org1, org2) => org1.name.localeCompare(org2.name));
    const pinned = organizations.filter((organization) => organization.pinned);
    const data = { organizations, pinned };
    await ui.webview.setContentFromTemplate("organization", data);
}

/**
 * Logs the user out, updating UI state
 */
export function logout(visibility: VisibilityGroups, { tmc, ui }: ActionContext) {
    tmc.deauthenticate();
    ui.webview.dispose();
    ui.treeDP.updateVisibility([visibility.LOGGED_IN.not]);
}
