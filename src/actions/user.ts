/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group of actions that respond to the user.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import * as vscode from "vscode";

import { LocalCourseData } from "../config/types";
import TemporaryWebview from "../ui/temporaryWebview";
import { VisibilityGroups } from "../ui/treeview/types";
import { askForConfirmation, isWorkspaceOpen, parseFeedbackQuestion, sleep } from "../utils";
import { ActionContext, FeedbackQuestion } from "./types";
import { displayUserCourses, selectOrganizationAndCourse } from "./webview";
import { closeExercises } from "./workspace";

import { Err, Ok, Result } from "ts-results";
import { CourseExercise, Exercise, SubmissionFeedback } from "../api/types";

/**
 * Authenticates and logs the user in if credentials are correct.
 */
export async function login(
    actionContext: ActionContext,
    username: string,
    password: string,
    visibilityGroups: VisibilityGroups,
): Promise<Result<void, Error>> {
    const { tmc, ui } = actionContext;

    if (!username || !password) {
        return new Err(new Error("Username and password may not be empty."));
    }

    const result = await tmc.authenticate(username, password);
    if (result.err) {
        return new Err(result.val);
    }

    ui.treeDP.updateVisibility([visibilityGroups.LOGGED_IN]);
    return Ok.EMPTY;
}

/**
 * Logs the user out, updating UI state
 */
export async function logout(
    visibility: VisibilityGroups,
    actionContext: ActionContext,
): Promise<void> {
    if (await askForConfirmation("Are you sure you want to log out?")) {
        const { tmc, ui } = actionContext;
        tmc.deauthenticate();
        ui.webview.dispose();
        ui.treeDP.updateVisibility([visibility.LOGGED_IN.not]);
        vscode.window.showInformationMessage("Logged out from TestMyCode.");
    }
}

/**
 * Tests an exercise while keeping the user informed
 */
export async function testExercise(actionContext: ActionContext, id: number): Promise<void> {
    const { ui, resources, tmc, workspaceManager } = actionContext;
    const exerciseDetails = workspaceManager.getExerciseDataById(id);

    if (exerciseDetails.err) {
        vscode.window.showErrorMessage(
            `Getting exercise details failed: ${exerciseDetails.val.name} - ${exerciseDetails.val.message}`,
        );
        return;
    }
    const exerciseName = exerciseDetails.val.name;

    const temp = new TemporaryWebview(
        resources,
        ui,
        "TMC Test Results",
        async (msg: { type?: string; data?: { [key: string]: unknown } }) => {
            if (msg.type == "setToBackground") {
                temp.dispose();
            } else if (msg.type == "submitToServer" && msg.data) {
                submitExercise(actionContext, msg.data.exerciseId as number, temp);
            }
        },
    );

    temp.setContent("running-tests", { exerciseName });
    ui.setStatusBar(`Running tests for ${exerciseName}`);
    const testResult = await tmc.runTests(id);
    if (testResult.err) {
        ui.setStatusBar(`Running tests for ${exerciseName} failed`, 5000);
        temp.setContent("error", { error: testResult.val });
        vscode.window.showErrorMessage(`Exercise test run failed: \
       ${testResult.val.name} - ${testResult.val.message}`);
        return;
    }
    ui.setStatusBar(`Tests finished for ${exerciseName}`, 5000);
    const data = { testResult: testResult.val.response, id, exerciseName };
    temp.setContent("test-result", data);
}

/**
 * Submits an exercise while keeping the user informed
 * @param tempView Existing TemporaryWebview to use if any
 */
export async function submitExercise(
    actionContext: ActionContext,
    id: number,
    tempView?: TemporaryWebview,
): Promise<void> {
    const { ui, resources, tmc } = actionContext;
    const submitResult = await tmc.submitExercise(id);

    if (submitResult.err) {
        vscode.window.showErrorMessage(`Exercise submission failed: \
            ${submitResult.val.name} - ${submitResult.val.message}`);
        return;
    }

    const temp = tempView || new TemporaryWebview(resources, ui, "", () => {});

    temp.setMessageHandler(
        async (msg: { data?: { [key: string]: unknown }; type?: string }): Promise<void> => {
            if (msg.type == "feedback" && msg.data) {
                await tmc.submitSubmissionFeedback(
                    msg.data.url as string,
                    msg.data.feedback as SubmissionFeedback,
                );
            } else if (msg.type == "setToBackgroundInSubmission") {
                ui.setStatusBar("Waiting for results from server.");
                temp.dispose();
            } else if (msg.type == "showInBrowser") {
                vscode.env.openExternal(vscode.Uri.parse(submitResult.val.show_submission_url));
            } else if (msg.type == "showSolutionInBrowser" && msg.data) {
                vscode.env.openExternal(vscode.Uri.parse(msg.data.solutionUrl as string));
            }
        },
    );
    temp.setTitle("TMC Server Submission");

    let timeWaited = 0;
    let getStatus = true;
    while (getStatus) {
        const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
        if (statusResult.err) {
            vscode.window.showErrorMessage(
                `Failed getting submission status: ${statusResult.val.name} - ${statusResult.val.message}`,
            );
            break;
        }
        const statusData = statusResult.val;
        if (statusResult.val.status !== "processing") {
            ui.setStatusBar("Tests finished, see result", 5000);
            let feedbackQuestions: FeedbackQuestion[] = [];
            if (statusData.status === "ok" && statusData.all_tests_passed) {
                if (statusData.feedback_questions) {
                    feedbackQuestions = parseFeedbackQuestion(statusData.feedback_questions);
                }
            }
            temp.setContent("submission-result", { statusData, feedbackQuestions });
            break;
        }

        if (!temp.disposed) {
            temp.setContent("submission-status", statusData);
        }

        await sleep(2500);
        timeWaited = timeWaited + 2500;

        if (timeWaited === 120000) {
            vscode.window
                .showInformationMessage(
                    `This seems to be taking a long time — consider continuing to the next exercise while this is running. \
                Your submission will still be graded. Check the results later at ${submitResult.val.show_submission_url}`,
                    ...["Open URL and move on...", "No, I'll wait"],
                )
                .then((selection) => {
                    if (selection === "Open URL and move on...") {
                        vscode.env.openExternal(
                            vscode.Uri.parse(submitResult.val.show_submission_url),
                        );
                        getStatus = false;
                        temp.dispose();
                    }
                });
        }
    }
}

/**
 * Sends the exercise to the TMC Paste server.
 * @param id Exercise ID
 */
export async function pasteExercise(actionContext: ActionContext, id: number): Promise<void> {
    const { tmc } = actionContext;
    const params = new Map<string, string>();
    params.set("paste", "1");
    const submitResult = await tmc.submitExercise(id, params);

    if (submitResult.err) {
        vscode.window.showErrorMessage(`Failed to paste exercise to server: \
                ${submitResult.val.name} - ${submitResult.val.message}`);
        return;
    }

    vscode.window
        .showInformationMessage(
            `Paste to TMC Server successful: \
            ${submitResult.val.paste_url}`,
            ...["Open URL"],
        )
        .then((selection) => {
            if (selection == "Open URL") {
                vscode.env.openExternal(vscode.Uri.parse(submitResult.val.paste_url));
            }
        });
}

/**
 * Opens the TMC workspace in explorer. If a workspace is already opened, asks user first.
 */
export async function openWorkspace(actionContext: ActionContext): Promise<void> {
    const { resources } = actionContext;
    const currentWorkspaceFile = vscode.workspace.workspaceFile;
    const tmcWorkspaceFile = vscode.Uri.file(resources.tmcWorkspaceFilePath);

    if (!isWorkspaceOpen(resources)) {
        console.log("Current workspace:", currentWorkspaceFile);
        console.log("TMC workspace:", tmcWorkspaceFile);
        if (
            !currentWorkspaceFile ||
            (await askForConfirmation(
                "Do you want to open TMC workspace and close the current one?",
            ))
        ) {
            vscode.commands.executeCommand("vscode.openFolder", tmcWorkspaceFile);
            // Restarts VSCode
        } else {
            const choice = "Close current and open TMC Workspace";
            await vscode.window
                .showErrorMessage(
                    "Please close your current workspace before using TestMyCode.",
                    choice,
                )
                .then((selection) => {
                    if (selection === choice) {
                        vscode.commands.executeCommand("vscode.openFolder", tmcWorkspaceFile);
                    }
                });
        }
    }
}

/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(actionContext: ActionContext): Promise<Result<void, Error>> {
    const orgAndCourse = await selectOrganizationAndCourse(actionContext);

    if (orgAndCourse.err) {
        return new Err(orgAndCourse.val);
    }

    const { tmc, userData } = actionContext;
    const courseDetailsResult = await tmc.getCourseDetails(orgAndCourse.val.course);
    const courseExercises = await tmc.getCourseExercises(orgAndCourse.val.course);
    if (courseDetailsResult.err) {
        return new Err(courseDetailsResult.val);
    }
    if (courseExercises.err) {
        return new Err(courseExercises.val);
    }

    const courseDetails = courseDetailsResult.val.course;
    const exercises = courseExercises.val;

    let availablePoints = 0;
    let awardedPoints = 0;
    exercises.forEach((x) => {
        availablePoints += x.available_points.length;
        awardedPoints += x.awarded_points.length;
    });

    const localData: LocalCourseData = {
        description: courseDetails.description || "",
        exercises: courseDetails.exercises.map((e) => ({ id: e.id, passed: e.completed })),
        id: courseDetails.id,
        name: courseDetails.name,
        organization: orgAndCourse.val.organization,
        availablePoints: availablePoints,
        awardedPoints: awardedPoints,
    };
    userData.addCourse(localData);
    await displayUserCourses(actionContext);
    return Ok.EMPTY;
}

/**
 * Removes given course from UserData and closes all its exercises.
 * @param id ID of the course to remove
 */
export async function removeCourse(id: number, actionContext: ActionContext): Promise<void> {
    const course = actionContext.userData.getCourse(id);
    await closeExercises(
        actionContext,
        course.exercises.map((e) => e.id),
    );
    actionContext.userData.deleteCourse(id);
}

export async function updateCourse(id: number, actionContext: ActionContext): Promise<void> {
    const { tmc, userData, workspaceManager } = actionContext;
    return Promise.all([tmc.getCourseDetails(id, false), tmc.getCourseExercises(id, false)]).then(
        ([courseDetailsResult, courseExercisesResult]) => {
            if (courseDetailsResult.ok) {
                const details = courseDetailsResult.val.course;
                userData.updateCompletedExercises(
                    id,
                    details.exercises.filter((x) => x.completed).map((x) => x.id),
                );
            }
            if (courseExercisesResult.ok) {
                const exercises = courseExercisesResult.val;
                const [available, awarded] = exercises.reduce(
                    (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
                    [0, 0],
                );
                userData.updatePoints(id, awarded, available);
            }

            if (courseExercisesResult.ok && courseDetailsResult.ok) {
                const details = courseDetailsResult.val.course;
                const exercises = courseExercisesResult.val;
                const combinedDetails: Map<
                    number,
                    { c?: CourseExercise; e?: Exercise }
                > = new Map();
                details.exercises.forEach((x) => {
                    combinedDetails.set(x.id, { e: x });
                });
                exercises.forEach((x) => {
                    let d = combinedDetails.get(x.id);
                    if (d) d.c = x;
                    else d = { c: x };
                    combinedDetails.set(x.id, d);
                });
                for (const x of combinedDetails.values()) {
                    if (x.c && x.e) {
                        workspaceManager.updateExerciseData(
                            x.c.id,
                            x.c.soft_deadline,
                            x.c.deadline,
                            x.e.checksum,
                        );
                    }
                }
            }
        },
    );
}
