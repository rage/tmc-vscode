/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that respond to the user.
 * -------------------------------------------------------------------------------------------------
 */

import { sync as delSync } from "del";
import du = require("du");
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { SubmissionFeedback } from "../api/types";
import { EXAM_TEST_RESULT, NOTIFICATION_DELAY } from "../config/constants";
import { ExerciseStatus, LocalCourseData } from "../config/types";
import { ConnectionError, ForbiddenError } from "../errors";
import { TestResultData } from "../ui/types";
import {
    formatSizeInBytes,
    isCorrectWorkspaceOpen,
    Logger,
    parseFeedbackQuestion,
} from "../utils/";
import {
    askForConfirmation,
    getActiveEditorExecutablePath,
    showError,
    showNotification,
} from "../window";

import { ActionContext, FeedbackQuestion } from "./types";
import { displayUserCourses, selectOrganizationAndCourse } from "./webview";
import { closeExercises, downloadExercises, openExercises } from "./workspace";

/**
 * Authenticates and logs the user in if credentials are correct.
 */
export async function login(
    actionContext: ActionContext,
    username: string,
    password: string,
): Promise<Result<void, Error>> {
    const { tmc } = actionContext;

    if (!username || !password) {
        return new Err(new Error("Username and password may not be empty."));
    }

    const result = await tmc.authenticate(username, password);
    if (result.err) {
        return result;
    }

    return Ok.EMPTY;
}

/**
 * Logs the user out, updating UI state
 */
export async function logout(actionContext: ActionContext): Promise<Result<void, Error>> {
    const { tmc } = actionContext;

    const result = await tmc.deauthenticate();
    if (result.err) {
        return result;
    }

    return Ok.EMPTY;
}

/**
 * Tests an exercise while keeping the user informed
 */
export async function testExercise(
    actionContext: ActionContext,
    id: number,
): Promise<Result<void, Error>> {
    const { ui, tmc, userData, workspaceManager, temporaryWebviewProvider } = actionContext;
    const exerciseDetails = workspaceManager.getExerciseDataById(id);
    if (exerciseDetails.err) {
        return exerciseDetails;
    }

    const course = userData.getCourseByName(exerciseDetails.val.course);
    let data: TestResultData = { ...EXAM_TEST_RESULT, id, disabled: course.disabled };
    const temp = temporaryWebviewProvider.getTemporaryWebview();

    if (!course.perhapsExamMode) {
        const executablePath = getActiveEditorExecutablePath(actionContext);
        const exercisePath = workspaceManager.getExercisePathById(id);
        if (exercisePath.err) {
            return exercisePath;
        }
        const [testRunner, interrupt] = tmc.runTests(exercisePath.val, executablePath);
        let aborted = false;
        const exerciseName = exerciseDetails.val.name;

        temp.setContent({
            title: "TMC Running tests",
            template: { templateName: "running-tests", exerciseName },
            messageHandler: async (msg: { type?: string; data?: { [key: string]: unknown } }) => {
                if (msg.type === "closeWindow") {
                    temp.dispose();
                } else if (msg.type === "abortTests") {
                    interrupt();
                    aborted = true;
                }
            },
        });
        ui.setStatusBar(`Running tests for ${exerciseName}`);
        Logger.log(`Running local tests for ${exerciseName}`);

        const testResult = await testRunner;
        if (testResult.err) {
            ui.setStatusBar(
                `Running tests for ${exerciseName} ${aborted ? "aborted" : "failed"}`,
                5000,
            );
            if (aborted) {
                temp.dispose();
                return Ok.EMPTY;
            }
            temp.setContent({
                title: "TMC",
                template: { templateName: "error", error: testResult.val },
                messageHandler: (msg: { type?: string }) => {
                    if (msg.type === "closeWindow") {
                        temp.dispose();
                    }
                },
            });
            temporaryWebviewProvider.addToRecycables(temp);
            return testResult;
        }
        ui.setStatusBar(`Tests finished for ${exerciseName}`, 5000);
        Logger.log(`Tests finished for ${exerciseName}`);
        data = {
            testResult: testResult.val,
            id,
            exerciseName,
            tmcLogs: {},
            disabled: course.disabled,
        };
    }

    // Set test-result handlers.
    temp.setContent({
        title: "TMC Test Results",
        template: { templateName: "test-result", ...data, pasteLink: "" },
        messageHandler: async (msg: { type?: string; data?: { [key: string]: unknown } }) => {
            if (msg.type === "submitToServer" && msg.data) {
                submitExercise(actionContext, msg.data.exerciseId as number);
            } else if (msg.type === "sendToPaste" && msg.data) {
                const pasteLink = await pasteExercise(actionContext, msg.data.exerciseId as number);
                if (pasteLink.err) {
                    Logger.error(`${pasteLink.val.message}`, pasteLink.val);
                    showError(`Failed to send to TMC Paste: ${pasteLink.val.message}`);
                    temp.postMessage({
                        command: "showPasteLink",
                        pasteLink: `${pasteLink.val.message}`,
                    });
                } else {
                    const value = pasteLink.val || "Link not provided by server.";
                    temp.postMessage({ command: "showPasteLink", pasteLink: value });
                }
            } else if (msg.type === "closeWindow") {
                temp.dispose();
            }
        },
    });
    temporaryWebviewProvider.addToRecycables(temp);
    return Ok.EMPTY;
}

/**
 * Submits an exercise while keeping the user informed
 * @param tempView Existing TemporaryWebview to use if any
 */
export async function submitExercise(
    actionContext: ActionContext,
    id: number,
): Promise<Result<void, Error>> {
    const { temporaryWebviewProvider, tmc, userData, workspaceManager } = actionContext;

    Logger.log(
        `Submitting exercise ${workspaceManager.getExerciseDataById(id).val.name} to server`,
    );

    const exerciseDetails = workspaceManager.getExerciseDataById(id);
    if (exerciseDetails.err) {
        return exerciseDetails;
    }
    const temp = temporaryWebviewProvider.getTemporaryWebview();

    const messageHandler = async (msg: {
        data?: { [key: string]: unknown };
        type?: string;
    }): Promise<void> => {
        if (msg.type === "feedback" && msg.data) {
            await tmc.submitSubmissionFeedback(
                msg.data.url as string,
                msg.data.feedback as SubmissionFeedback,
            );
        } else if (msg.type === "showSubmissionInBrowserStatus" && msg.data) {
            vscode.env.openExternal(vscode.Uri.parse(msg.data.submissionUrl as string));
        } else if (msg.type === "showSubmissionInBrowserResult" && msg.data) {
            vscode.env.openExternal(vscode.Uri.parse(msg.data.submissionUrl as string));
        } else if (msg.type === "showSolutionInBrowser" && msg.data) {
            vscode.env.openExternal(vscode.Uri.parse(msg.data.solutionUrl as string));
        } else if (msg.type === "closeWindow") {
            temp.dispose();
        } else if (msg.type === "sendToPaste" && msg.data) {
            const pasteLink = await pasteExercise(actionContext, Number(msg.data.exerciseId));
            if (pasteLink.err) {
                Logger.error(`${pasteLink.val.message}`, pasteLink.val);
                showError(`Failed to send to TMC Paste: ${pasteLink.val.message}`);
                temp.postMessage({
                    command: "showPasteLink",
                    pasteLink: `${pasteLink.val.message}`,
                });
            } else {
                const value = pasteLink.val || "Link not provided by server.";
                temp.postMessage({ command: "showPasteLink", pasteLink: value });
            }
        }
    };

    const messages: string[] = [];
    const exerciseFolderPath = workspaceManager.getExercisePathById(id);
    if (exerciseFolderPath.err) {
        return exerciseFolderPath;
    }
    let submissionUrl = "";
    const submissionResult = await tmc.submitExerciseAndWaitForResults(
        id,
        exerciseFolderPath.val,
        (progressPct, message) => {
            if (message && message !== _.last(messages)) {
                messages.push(message);
            }
            if (!temp.disposed) {
                temp.setContent({
                    title: "TMC Server Submission",
                    template: {
                        templateName: "submission-status",
                        messages,
                        progressPct,
                        submissionUrl,
                    },
                    messageHandler,
                });
            }
        },
        (url) => {
            submissionUrl = url;
        },
    );

    if (submissionResult.err) {
        temp.setContent({
            title: "TMC Server Submission",
            template: { templateName: "error", error: submissionResult.val },
            messageHandler: async (msg: { type?: string }): Promise<void> => {
                if (msg.type === "closeWindow") {
                    temp.dispose();
                }
            },
        });
        temporaryWebviewProvider.addToRecycables(temp);
        return submissionResult;
    }

    const statusData = submissionResult.val;
    let feedbackQuestions: FeedbackQuestion[] = [];

    if (statusData.status === "ok" && statusData.all_tests_passed) {
        if (statusData.feedback_questions) {
            feedbackQuestions = parseFeedbackQuestion(statusData.feedback_questions);
        }
    }
    temp.setContent({
        title: "TMC Server Submission",
        template: {
            templateName: "submission-result",
            statusData,
            feedbackQuestions,
            submissionUrl,
        },
        messageHandler,
    });
    temporaryWebviewProvider.addToRecycables(temp);

    const courseData = userData.getCourseByName(exerciseDetails.val.course) as Readonly<
        LocalCourseData
    >;

    checkForCourseUpdates(actionContext, courseData.id);
    vscode.commands.executeCommand("tmc.updateExercises", "silent");

    return Ok.EMPTY;
}

/**
 * Sends the exercise to the TMC Paste server.
 * @param id Exercise ID
 * @returns TMC Pastebin link if the action was successful.
 */
export async function pasteExercise(
    actionContext: ActionContext,
    id: number,
): Promise<Result<string, Error>> {
    const { tmc, workspaceManager } = actionContext;
    const exerciseFolderPath = workspaceManager.getExercisePathById(id);
    if (exerciseFolderPath.err) {
        return exerciseFolderPath;
    }

    const pasteResult = await tmc.submitExerciseToPaste(id, exerciseFolderPath.val);
    if (pasteResult.err) {
        return pasteResult;
    }

    const pasteLink = pasteResult.val;
    if (pasteLink === "") {
        const message = "Didn't receive paste link from server.";
        return new Err(new Error(`Failed to send exercise to TMC Paste: ${message}`));
    }

    return new Ok(pasteLink);
}

/**
 * Check for course updates.
 * @param courseId If given, check only updates for that course.
 */
export async function checkForCourseUpdates(
    actionContext: ActionContext,
    courseId?: number,
): Promise<void> {
    const { ui, userData } = actionContext;
    const courses = courseId ? [userData.getCourse(courseId)] : userData.getCourses();
    const filteredCourses = courses.filter((c) => c.notifyAfter <= Date.now());
    Logger.log(`Checking for course updates for courses ${filteredCourses.map((c) => c.name)}`);
    const updatedCourses: LocalCourseData[] = [];
    for (const course of filteredCourses) {
        await updateCourse(actionContext, course.id);
        updatedCourses.push(userData.getCourse(course.id));
    }

    const handleDownload = async (course: LocalCourseData): Promise<void> => {
        const newIds = Array.from(course.newExercises);
        ui.webview.postMessage({
            command: "setNewExercises",
            courseId: course.id,
            exerciseIds: [],
        });
        const [successful] = await downloadExercises(
            actionContext,
            newIds.map((x) => ({
                courseId: course.id,
                exerciseId: x,
                organization: course.organization,
            })),
        );
        const successfulIds = successful.map((ex) => ex.exerciseId);
        await userData.clearFromNewExercises(course.id, successfulIds);
        ui.webview.postMessage({
            command: "setNewExercises",
            courseId: course.id,
            exerciseIds: course.newExercises,
        });
        const openResult = await openExercises(actionContext, successfulIds, course.name);
        if (openResult.err) {
            const message = "Failed to open new exercises.";
            Logger.error(message, openResult.val);
            showError(message);
        }
    };

    for (const course of updatedCourses) {
        if (course.newExercises.length > 0 && !course.disabled) {
            showNotification(
                `Found ${course.newExercises.length} new exercises for ${course.name}. Do you wish to download them now?`,
                ["Download", async (): Promise<void> => handleDownload(course)],
                [
                    "Remind me later",
                    (): void => {
                        userData.setNotifyDate(course.id, Date.now() + NOTIFICATION_DELAY);
                    },
                ],
                [
                    "Don't remind about these exercises",
                    (): void => {
                        userData.clearFromNewExercises(course.id);
                    },
                ],
            );
        }
    }
}

/**
 * Opens the TMC workspace in explorer. If a workspace is already opened, asks user first.
 */
export async function openWorkspace(actionContext: ActionContext, name: string): Promise<void> {
    const { resources, workspaceManager } = actionContext;
    const currentWorkspaceFile = vscode.workspace.workspaceFile;
    const tmcWorkspaceFile = resources.getWorkspaceFilePath(name);
    const workspaceAsUri = vscode.Uri.file(tmcWorkspaceFile);
    Logger.log(`Current workspace: ${currentWorkspaceFile?.fsPath}`);
    Logger.log(`TMC workspace: ${tmcWorkspaceFile}`);

    if (!isCorrectWorkspaceOpen(resources, name)) {
        if (
            !currentWorkspaceFile ||
            (await askForConfirmation(
                "Do you want to open TMC workspace and close the current one?",
            ))
        ) {
            if (!fs.existsSync(tmcWorkspaceFile)) {
                workspaceManager.createWorkspaceFile(name);
            }
            await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
            // Restarts VSCode
        } else {
            const choice = "Close current & open Course Workspace";
            await showError(
                "Please close the current workspace before opening a course workspace.",
                [
                    choice,
                    async (): Promise<Thenable<unknown>> => {
                        if (!fs.existsSync(tmcWorkspaceFile)) {
                            workspaceManager.createWorkspaceFile(name);
                        }
                        return vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
                    },
                ],
            );
        }
    } else if (currentWorkspaceFile?.fsPath === tmcWorkspaceFile) {
        Logger.log("Workspace already open, changing focus to this workspace.");
        await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
        await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");
    }
}

/**
 * Settings webview
 */
export async function openSettings(actionContext: ActionContext): Promise<void> {
    const { ui, resources, settings } = actionContext;
    Logger.log("Display extension settings");
    const extensionSettings = await settings.getExtensionSettings();
    if (extensionSettings.err) {
        const message = "Failed to fetch Settings.";
        Logger.error(message, extensionSettings.val);
        showError(message);
        return;
    }
    ui.webview.setContentFromTemplate(
        {
            templateName: "settings",
            extensionSettings: extensionSettings.val,
            tmcDataSize: formatSizeInBytes(await du(resources.getDataPath())),
        },
        true,
    );
}

interface NewCourseOptions {
    organization?: string;
    course?: number;
}
/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(
    actionContext: ActionContext,
    options?: NewCourseOptions,
): Promise<Result<void, Error>> {
    const { tmc, ui, userData, workspaceManager } = actionContext;
    Logger.log("Adding new course");
    let organization = options?.organization;
    let course = options?.course;

    if (!organization || !course) {
        const orgAndCourse = await selectOrganizationAndCourse(actionContext);
        if (orgAndCourse.err) {
            return orgAndCourse;
        }
        organization = orgAndCourse.val.organization;
        course = orgAndCourse.val.course;
    }

    const courseDataResult = await tmc.getCourseData(course);
    if (courseDataResult.err) {
        return courseDataResult;
    }
    const courseData = courseDataResult.val;

    let availablePoints = 0;
    let awardedPoints = 0;
    courseData.exercises.forEach((x) => {
        availablePoints += x.available_points.length;
        awardedPoints += x.awarded_points.length;
    });

    const localData: LocalCourseData = {
        description: courseData.details.description || "",
        exercises: courseData.details.exercises.map((e) => ({
            id: e.id,
            name: e.name,
            deadline: e.deadline,
            passed: e.completed,
            softDeadline: e.soft_deadline,
        })),
        id: courseData.details.id,
        name: courseData.details.name,
        title: courseData.details.title,
        organization: organization,
        availablePoints: availablePoints,
        awardedPoints: awardedPoints,
        perhapsExamMode: courseData.settings.hide_submission_results,
        newExercises: [],
        notifyAfter: 0,
        disabled: courseData.settings.disabled_status === "enabled" ? false : true,
        material_url: courseData.settings.material_url,
    };
    userData.addCourse(localData);
    ui.treeDP.addChildWithId("myCourses", localData.id, localData.title, {
        command: "tmc.courseDetails",
        title: "Go To Course Details",
        arguments: [localData.id],
    });
    workspaceManager.createWorkspaceFile(courseData.details.name);
    await displayUserCourses(actionContext);
    return Ok.EMPTY;
}

/**
 * Removes given course from UserData and closes all its exercises.
 * @param id ID of the course to remove
 */
export async function removeCourse(actionContext: ActionContext, id: number): Promise<void> {
    const { ui, userData, workspaceManager, resources } = actionContext;
    const course = userData.getCourse(id);
    Logger.log(`Closing exercises for ${course.name} and removing course data from userData`);
    const closeResult = await closeExercises(
        actionContext,
        course.exercises.map((e) => e.id),
        course.name,
    );
    if (closeResult.err) {
        const message = "Failed to close exercises while removing course.";
        Logger.error(message, closeResult.val);
        showError(message);
    }
    const exercises = workspaceManager.getAllExerciseDataByCourseName(course.name);
    const missingIds = exercises
        .filter((e) => e.status === ExerciseStatus.MISSING)
        .map((e) => e.id);
    Logger.log(`Removing ${missingIds.length} exercise data with Missing status`);
    workspaceManager.deleteExercise(...missingIds);
    delSync(path.join(resources.getWorkspaceFolderPath(), course.name, ".code-workspace"), {
        force: true,
    });
    userData.deleteCourse(id);
    ui.treeDP.removeChildWithId("myCourses", id.toString());
}

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * @param courseId ID of the course to update.
 * @returns Boolean value representing whether the data from server was succesfully received.
 */
export async function updateCourse(
    actionContext: ActionContext,
    courseId: number,
): Promise<Result<boolean, Error>> {
    const { tmc, ui, userData } = actionContext;
    const postMessage = (courseId: number, disabled: boolean, exerciseIds: number[]): void => {
        ui.webview.postMessage(
            {
                command: "setNewExercises",
                courseId,
                exerciseIds,
            },
            {
                command: "setCourseDisabledStatus",
                courseId,
                disabled,
            },
        );
    };
    const courseData = userData.getCourse(courseId);
    const updateResult = await tmc.getCourseData(courseId, { forceRefresh: true });
    if (updateResult.err) {
        if (updateResult.val instanceof ForbiddenError) {
            if (!courseData.disabled) {
                Logger.warn(
                    `Failed to access information for course ${courseData.name}. Marking as disabled.`,
                );
                const course = userData.getCourse(courseId);
                await userData.updateCourse({ ...course, disabled: true });
                postMessage(course.id, true, []);
            } else {
                Logger.warn(
                    `ForbiddenError above probably caused by course still being disabled ${courseData.name}`,
                );
                postMessage(courseData.id, true, []);
            }
            return Ok(false);
        } else if (updateResult.val instanceof ConnectionError) {
            Logger.warn("Failed to fetch data from TMC servers, data not updated.");
            return Ok(false);
        } else {
            return updateResult;
        }
    }

    const { details, exercises, settings } = updateResult.val;
    const [availablePoints, awardedPoints] = exercises.reduce(
        (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
        [0, 0],
    );

    await userData.updateCourse({
        ...courseData,
        availablePoints,
        awardedPoints,
        description: details.description || "",
        disabled: settings.disabled_status !== "enabled",
        material_url: settings.material_url,
        perhapsExamMode: settings.hide_submission_results,
    });

    const updateExercisesResult = await userData.updateExercises(
        courseId,
        details.exercises.map((x) => ({
            id: x.id,
            name: x.name,
            deadline: x.deadline,
            passed: x.completed,
            softDeadline: x.soft_deadline,
        })),
    );
    if (updateExercisesResult.err) {
        return updateExercisesResult;
    }

    const course = userData.getCourse(courseId);
    postMessage(course.id, course.disabled, course.newExercises);

    return Ok(true);
}
