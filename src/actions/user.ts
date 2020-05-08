/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group of actions that respond to the user.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import * as vscode from "vscode";

import { ExerciseStatus, LocalCourseData } from "../config/types";
import TemporaryWebview from "../ui/temporaryWebview";
import { VisibilityGroups } from "../ui/types";
import {
    askForConfirmation,
    formatSizeInBytes,
    getCurrentExerciseData,
    isWorkspaceOpen,
    parseFeedbackQuestion,
    showNotification,
    sleep,
} from "../utils/";
import { ActionContext, FeedbackQuestion } from "./types";
import { displayCourseDownloads, displayUserCourses, selectOrganizationAndCourse } from "./webview";
import { checkForExerciseUpdates, closeExercises } from "./workspace";

import { Err, Ok, Result } from "ts-results";
import { CourseExercise, Exercise, OldSubmission, SubmissionFeedback } from "../api/types";
import du = require("du");
import { NOTIFICATION_DELAY } from "../config/constants";

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
        showNotification("Logged out from TestMyCode.");
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

    const [testRunner, interrupt] = tmc.runTests(id);
    let aborted = false;
    const temp = new TemporaryWebview(
        resources,
        ui,
        "TMC Test Results",
        async (msg: { type?: string; data?: { [key: string]: unknown } }) => {
            if (msg.type === "closeWindow") {
                temp.dispose();
            } else if (msg.type === "abortTests") {
                interrupt();
                aborted = true;
            }
        },
    );
    const exerciseName = exerciseDetails.val.name;
    temp.setContent({ templateName: "running-tests", exerciseName });
    ui.setStatusBar(`Running tests for ${exerciseName}`);
    console.log(`Running local tests for ${exerciseName}`);

    const testResult = await testRunner;
    if (testResult.err) {
        ui.setStatusBar(
            `Running tests for ${exerciseName} ${aborted ? "aborted" : "failed"}`,
            5000,
        );
        if (aborted) {
            temp.dispose();
            return;
        }
        temp.setContent({ templateName: "error", error: testResult.val });
        vscode.window.showErrorMessage(`Exercise test run failed: \
                                        ${testResult.val.name} - ${testResult.val.message}`);
        return;
    }
    ui.setStatusBar(`Tests finished for ${exerciseName}`, 5000);
    console.log(`Tests finished for ${exerciseName}`);
    const data = {
        testResult: testResult.val.response,
        id,
        exerciseName,
        tmcLogs: testResult.val.logs,
    };

    // Set test-result handlers.
    temp.addMessageHandler(async (msg: { type?: string; data?: { [key: string]: unknown } }) => {
        if (msg.type === "submitToServer" && msg.data) {
            submitExercise(actionContext, msg.data.exerciseId as number, temp);
        } else if (msg.type === "sendToPaste" && msg.data) {
            const pasteLink = await pasteExercise(actionContext, msg.data.exerciseId as number);
            temp.setContent({ templateName: "test-result", ...data, pasteLink });
        }
    });
    temp.setContent({ templateName: "test-result", ...data });
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
    const { ui, resources, tmc, userData, workspaceManager } = actionContext;
    console.log(
        `Submitting exercise ${workspaceManager.getExerciseDataById(id).val.name} to server`,
    );
    const submitResult = await tmc.submitExercise(id);

    const temp =
        tempView ||
        new TemporaryWebview(resources, ui, "", async (msg: { type?: string }) => {
            if (msg.type === "closeWindow") {
                temp.dispose();
            }
        });
    temp.setTitle("TMC Server Submission");

    if (submitResult.err) {
        temp.setContent({ templateName: "error", error: submitResult.val });
        vscode.window.showErrorMessage(`Exercise submission failed: \
            ${submitResult.val.name} - ${submitResult.val.message}`);
        return;
    }

    temp.addMessageHandler(
        async (msg: { data?: { [key: string]: unknown }; type?: string }): Promise<void> => {
            if (msg.type === "feedback" && msg.data) {
                await tmc.submitSubmissionFeedback(
                    msg.data.url as string,
                    msg.data.feedback as SubmissionFeedback,
                );
            } else if (msg.type === "showInBrowser") {
                vscode.env.openExternal(vscode.Uri.parse(submitResult.val.show_submission_url));
            } else if (msg.type === "showSolutionInBrowser" && msg.data) {
                vscode.env.openExternal(vscode.Uri.parse(msg.data.solutionUrl as string));
            }
        },
    );

    let notified = false;
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
            let courseId = undefined;
            if (statusData.status === "ok" && statusData.all_tests_passed) {
                if (statusData.feedback_questions) {
                    feedbackQuestions = parseFeedbackQuestion(statusData.feedback_questions);
                }
                courseId = userData.getCourseByName(statusData.course).id;
            }
            temp.setContent({ templateName: "submission-result", statusData, feedbackQuestions });
            // Check for new exercises if exercise passed.
            if (courseId) {
                checkForNewExercises(actionContext, courseId);
            }
            checkForExerciseUpdates(actionContext);
            break;
        }

        if (!temp.disposed) {
            temp.setContent({ templateName: "submission-status", statusData });
        }

        await sleep(2500);
        timeWaited = timeWaited + 2500;

        if (timeWaited >= 120000 && !notified) {
            notified = true;
            showNotification(
                `This seems to be taking a long time — consider continuing to the next exercise while this is running. \
                Your submission will still be graded. Check the results later at ${submitResult.val.show_submission_url}`,
                [
                    "Open URL and move on...",
                    (): void => {
                        vscode.env.openExternal(
                            vscode.Uri.parse(submitResult.val.show_submission_url),
                        );
                        getStatus = false;
                        temp.dispose();
                    },
                ],
                ["No, I'll wait", (): void => {}],
            );
        }
    }
}
/**
 * Gets all submission ids from currently selected courses and maps them to corresponding exercises
 *
 */
export async function getOldSubmissions(
    actionContext: ActionContext,
): Promise<Result<OldSubmission[], Error>> {
    const { userData, tmc, workspaceManager } = actionContext;
    const currentExercise = getCurrentExerciseData(workspaceManager);
    if (currentExercise.err) {
        return new Err(new Error("Exercise not found in workspacemanager"));
    }
    const course = userData.getCourseByName(currentExercise.val.course);
    const result = await tmc.fetchOldSubmissionIds(course.id);
    if (result.err) {
        return new Err(new Error("Couldn't fetch old submissions"));
    }
    const currentExerciseName = currentExercise.val.name;
    const exerciseSubmissions = result.val.filter((e) => e.exercise_name === currentExerciseName);

    return new Ok(exerciseSubmissions);
}

/**
 * Sends the exercise to the TMC Paste server.
 * @param id Exercise ID
 */
export async function pasteExercise(actionContext: ActionContext, id: number): Promise<string> {
    const { tmc } = actionContext;
    const params = new Map<string, string>();
    params.set("paste", "1");
    const submitResult = await tmc.submitExercise(id, params);

    if (submitResult.err) {
        vscode.window.showErrorMessage(`Failed to paste exercise to server: \
                ${submitResult.val.name} - ${submitResult.val.message}`);
        return "";
    }
    return submitResult.val.paste_url;
}

/**
 * Finds new exercises for all user's courses and prompts to go download them.
 * @param courseId If given, check only updates for that course.
 */
export async function checkForNewExercises(
    actionContext: ActionContext,
    courseId?: number,
): Promise<void> {
    const { userData } = actionContext;
    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    const filteredCourses = courses.filter((c) => c.notifyAfter <= Date.now());
    console.log(`Checking for new exercises for courses ${filteredCourses.map((c) => c.name)}`);
    const updatedCourses: LocalCourseData[] = [];
    for (const course of filteredCourses) {
        await updateCourse(course.id, actionContext);
        updatedCourses.push(userData.getCourse(course.id));
    }

    for (const course of updatedCourses) {
        if (course.newExercises.length > 0) {
            showNotification(
                `${course.newExercises.length} new exercises found for ${course.name}. Do you wish to move to the downloads page?`,
                [
                    "Go to downloads",
                    (): void => {
                        displayCourseDownloads(actionContext, course.id);
                    },
                ],
                [
                    "Remind me later",
                    (): void => {
                        userData.setNotifyDate(course.id, Date.now() + NOTIFICATION_DELAY);
                    },
                ],
            );
        }
    }
}

/**
 * Opens the TMC workspace in explorer. If a workspace is already opened, asks user first.
 */
export async function openWorkspace(actionContext: ActionContext): Promise<void> {
    const { resources } = actionContext;
    const currentWorkspaceFile = vscode.workspace.workspaceFile;
    const tmcWorkspaceFile = vscode.Uri.file(resources.getWorkspaceFilePath());

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
 * Settings webview
 */
export async function openSettings(actionContext: ActionContext): Promise<void> {
    const { ui, resources } = actionContext;
    console.log("Display extension settings");
    ui.webview.setContentFromTemplate({
        templateName: "settings",
        tmcData: resources.getDataPath(),
        tmcDataSize: formatSizeInBytes(await du(resources.getDataPath())),
    });
}

/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(actionContext: ActionContext): Promise<Result<void, Error>> {
    console.log("Adding new course");
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
        title: courseDetails.title,
        organization: orgAndCourse.val.organization,
        availablePoints: availablePoints,
        awardedPoints: awardedPoints,
        newExercises: [],
        notifyAfter: 0,
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
    const { userData, workspaceManager } = actionContext;
    const course = userData.getCourse(id);
    console.log(`Closing exercises for ${course.name} and removing course data from userData`);
    await closeExercises(
        actionContext,
        course.exercises.map((e) => e.id),
    );
    const exercises = workspaceManager.getExercisesByCourseName(course.name);
    const missingIds = exercises
        .filter((e) => e.status === ExerciseStatus.MISSING)
        .map((e) => e.id);
    console.log(`Removing ${missingIds.length} exercise data with Missing status`);
    workspaceManager.deleteExercise(...missingIds);
    userData.deleteCourse(id);
}

/**
 * Keeps the user course exercises, points and course data up to date.
 * @param id Course id
 */
export async function updateCourse(id: number, actionContext: ActionContext): Promise<void> {
    const { tmc, userData, workspaceManager } = actionContext;
    return Promise.all([tmc.getCourseDetails(id), tmc.getCourseExercises(id)]).then(
        ([courseDetailsResult, courseExercisesResult]) => {
            console.log(
                `Refreshing exercise data for course ${userData.getCourse(id).name} from API`,
            );
            if (courseDetailsResult.ok) {
                const details = courseDetailsResult.val.course;
                userData.updateExercises(
                    id,
                    details.exercises.map((x) => ({ id: x.id, passed: x.completed })),
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
