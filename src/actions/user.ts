/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that respond to the user.
 * -------------------------------------------------------------------------------------------------
 */

import du = require("du");
import * as fs from "fs-extra";
import path = require("path");
import { Err, Ok, Result } from "ts-results";

import { OldSubmission, SubmissionFeedback } from "../api/types";
import { askForConfirmation, showError, showNotification } from "../api/vscode";
import { EXAM_SUBMISSION_RESULT, EXAM_TEST_RESULT, NOTIFICATION_DELAY } from "../config/constants";
import { ExerciseStatus, LocalCourseData } from "../config/types";
import { AuthorizationError, ConnectionError } from "../errors";
import { TestResultData, VisibilityGroups } from "../ui/types";
import {
    formatSizeInBytes,
    getCurrentExerciseData,
    isCorrectWorkspaceOpen,
    Logger,
    LogLevel,
    parseFeedbackQuestion,
    sleep,
} from "../utils/";

import { ActionContext, FeedbackQuestion } from "./types";
import { displayUserCourses, selectOrganizationAndCourse } from "./webview";
import {
    checkForExerciseUpdates,
    closeExercises,
    downloadExercises,
    openExercises,
} from "./workspace";

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
    actionContext: ActionContext,
    visibility: VisibilityGroups,
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
    const {
        ui,
        tmc,
        userData,
        workspaceManager,
        temporaryWebviewProvider,
        vsc,
        settings,
    } = actionContext;
    const exerciseDetails = workspaceManager.getExerciseDataById(id);
    if (exerciseDetails.err) {
        const message = `Getting exercise details failed: ${exerciseDetails.val.name} - ${exerciseDetails.val.message}`;
        Logger.error(message);
        showError(message);
        return;
    }
    const courseExamMode = userData.getCourseByName(exerciseDetails.val.course);

    let data: TestResultData = {
        ...EXAM_TEST_RESULT,
        id,
        disabled: userData.getCourseByName(exerciseDetails.val.course).disabled,
    };
    const temp = temporaryWebviewProvider.getTemporaryWebview();

    if (!courseExamMode.perhapsExamMode) {
        const executablePath = vsc.getActiveEditorExecutablePath();
        const [testRunner, interrupt] = tmc.runTests(id, settings.isInsider(), executablePath);
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
                return;
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
            const message = `Exercise test run failed: ${testResult.val.name} - ${testResult.val.message}`;
            Logger.error(message);
            showError(
                message,
                settings.getLogLevel() !== LogLevel.None
                    ? [
                          "Show logs",
                          (): void => {
                              Logger.show();
                          },
                      ]
                    : ["Ok", (): void => {}],
            );
            return;
        }
        ui.setStatusBar(`Tests finished for ${exerciseName}`, 5000);
        Logger.log(`Tests finished for ${exerciseName}`);
        data = {
            testResult: testResult.val.response,
            id,
            exerciseName,
            tmcLogs: testResult.val.logs,
            disabled: userData.getCourseByName(exerciseDetails.val.course).disabled,
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
                pasteLink && temp.postMessage({ command: "showPasteLink", pasteLink });
            } else if (msg.type === "closeWindow") {
                temp.dispose();
            }
        },
    });
    temporaryWebviewProvider.addToRecycables(temp);
}

/**
 * Submits an exercise while keeping the user informed
 * @param tempView Existing TemporaryWebview to use if any
 */
export async function submitExercise(actionContext: ActionContext, id: number): Promise<void> {
    const { ui, temporaryWebviewProvider, tmc, vsc, userData, workspaceManager } = actionContext;
    Logger.log(
        `Submitting exercise ${workspaceManager.getExerciseDataById(id).val.name} to server`,
    );
    const submitResult = await tmc.submitExercise(id);
    const exerciseDetails = workspaceManager.getExerciseDataById(id);
    if (exerciseDetails.err) {
        const message = `Getting exercise details failed: ${exerciseDetails.val.name} - ${exerciseDetails.val.message}`;
        Logger.error(message);
        showError(message);
        return;
    }
    const courseData = userData.getCourseByName(exerciseDetails.val.course);

    const temp = temporaryWebviewProvider.getTemporaryWebview();

    if (submitResult.err) {
        temp.setContent({
            title: "TMC Server Submission",
            template: { templateName: "error", error: submitResult.val },
            messageHandler: async (msg: { type?: string }): Promise<void> => {
                if (msg.type === "closeWindow") {
                    temp.dispose();
                }
            },
        });
        const message = `Exercise submission failed: ${submitResult.val.name} - ${submitResult.val.message}`;
        Logger.error(message);
        showError(message);
        return;
    }

    if (courseData.perhapsExamMode) {
        const examData = EXAM_SUBMISSION_RESULT;
        const submitUrl = submitResult.val.show_submission_url;
        const feedbackQuestions: FeedbackQuestion[] = [];
        temp.setContent({
            title: "TMC Server Submission",
            template: {
                templateName: "submission-result",
                statusData: examData,
                feedbackQuestions,
            },
            messageHandler: async (msg: { type?: string }) => {
                if (msg.type === "closeWindow") {
                    temp.dispose();
                } else if (msg.type === "showInBrowser") {
                    vsc.openUri(submitUrl);
                }
            },
        });
        temporaryWebviewProvider.addToRecycables(temp);
        return;
    }

    const messageHandler = async (msg: {
        data?: { [key: string]: unknown };
        type?: string;
    }): Promise<void> => {
        if (msg.type === "feedback" && msg.data) {
            await tmc.submitSubmissionFeedback(
                msg.data.url as string,
                msg.data.feedback as SubmissionFeedback,
            );
        } else if (msg.type === "showInBrowser") {
            vsc.openUri(submitResult.val.show_submission_url);
        } else if (msg.type === "showSolutionInBrowser" && msg.data) {
            vsc.openUri(msg.data.solutionUrl as string);
        } else if (msg.type === "closeWindow") {
            temp.dispose();
        }
    };

    let notified = false;
    let timeWaited = 0;
    let getStatus = true;
    while (getStatus) {
        const statusResult = await tmc.getSubmissionStatus(submitResult.val.submission_url);
        if (statusResult.err) {
            const message = `Failed getting submission status: ${statusResult.val.name} - ${statusResult.val.message}`;
            Logger.error(message);
            showError(message);
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
            temp.setContent({
                title: "TMC Server Submission",
                template: { templateName: "submission-result", statusData, feedbackQuestions },
                messageHandler,
            });
            temporaryWebviewProvider.addToRecycables(temp);
            // Check for new exercises if exercise passed.
            if (courseId) {
                checkForNewExercises(actionContext, courseId);
            }
            checkForExerciseUpdates(actionContext);
            break;
        }

        if (!temp.disposed) {
            temp.setContent({
                title: "TMC Server Submission",
                template: { templateName: "submission-status", statusData },
                messageHandler,
            });
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
                        vsc.openUri(submitResult.val.show_submission_url);
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
    const { tmc, workspaceManager } = actionContext;
    const currentExercise = getCurrentExerciseData(workspaceManager);
    if (currentExercise.err) {
        return new Err(new Error("Exercise not found in workspacemanager"));
    }
    const result = await tmc.fetchOldSubmissionIds(currentExercise.val.id);
    if (result.err) {
        return new Err(new Error("Couldn't fetch old submissions"));
    }

    return new Ok(result.val);
}

/**
 * Sends the exercise to the TMC Paste server.
 * @param id Exercise ID
 * @returns TMC Pastebin link if the action was successful.
 */
export async function pasteExercise(
    actionContext: ActionContext,
    id: number,
): Promise<string | undefined> {
    const { tmc } = actionContext;
    const params = new Map<string, string>();
    params.set("paste", "1");
    const submitResult = await tmc.submitExercise(id, params);

    const errorMessage = "Failed to send exercise to TMC pastebin";
    if (submitResult.err) {
        Logger.error(errorMessage, submitResult.val);
        showError(`${errorMessage}: ${submitResult.val.message}`);
        return undefined;
    } else if (!submitResult.val.paste_url) {
        const notProvided = "Paste link was not provided by the server.";
        Logger.warn(errorMessage, notProvided);
        showError(`${errorMessage}: ${notProvided}`);
        return undefined;
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
    const filteredCourses = courses.filter((c) => c.notifyAfter <= Date.now() && !c.disabled);
    Logger.log(`Checking for new exercises for courses ${filteredCourses.map((c) => c.name)}`);
    const updatedCourses: LocalCourseData[] = [];
    for (const course of filteredCourses) {
        await updateCourse(actionContext, course.id);
        updatedCourses.push(userData.getCourse(course.id));
    }

    for (const course of updatedCourses) {
        if (course.newExercises.length > 0) {
            showNotification(
                `Found ${course.newExercises.length} new exercises for ${course.name}. Do you wish to download them now?`,
                [
                    "Download",
                    async (): Promise<void> => {
                        userData.clearNewExercises(course.id);
                        await openExercises(
                            actionContext,
                            await downloadExercises(actionContext, [
                                {
                                    courseId: course.id,
                                    exerciseIds: course.newExercises,
                                    organizationSlug: course.organization,
                                    courseName: course.name,
                                },
                            ]),
                            course.name,
                        );
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
export async function openWorkspace(actionContext: ActionContext, name: string): Promise<void> {
    const { resources, vsc } = actionContext;
    const currentWorkspaceFile = vsc.getWorkspaceFile();
    const tmcWorkspaceFile = resources.getWorkspaceFilePath(name);
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
                resources.createWorkspaceFile(name);
            }
            vsc.openFolder(tmcWorkspaceFile);
            // Restarts VSCode
        } else {
            const choice = "Close current and open TMC Workspace";
            await showError("Please close your current workspace before using TestMyCode.", [
                choice,
                (): Thenable<unknown> => {
                    if (!fs.existsSync(tmcWorkspaceFile)) {
                        resources.createWorkspaceFile(name);
                    }
                    return vsc.openFolder(tmcWorkspaceFile);
                },
            ]);
        }
    } else if (currentWorkspaceFile?.fsPath === tmcWorkspaceFile) {
        await vsc.openFolder(tmcWorkspaceFile);
        await vsc.executeCommand("workbench.files.action.focusFilesExplorer");
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
        Logger.error("Failed to fetch Settings: ", extensionSettings);
        showError(`Failed to fetch Settings: ${extensionSettings.val}`);
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

/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(actionContext: ActionContext): Promise<Result<void, Error>> {
    const { tmc, userData, resources } = actionContext;
    Logger.log("Adding new course");
    const orgAndCourse = await selectOrganizationAndCourse(actionContext);

    if (orgAndCourse.err) {
        return new Err(orgAndCourse.val);
    }

    const courseDetailsResult = await tmc.getCourseDetails(orgAndCourse.val.course);
    const courseExercisesResult = await tmc.getCourseExercises(orgAndCourse.val.course);
    const courseSettingsResult = await tmc.getCourseSettings(orgAndCourse.val.course);
    if (courseDetailsResult.err) {
        return new Err(courseDetailsResult.val);
    }
    if (courseExercisesResult.err) {
        return new Err(courseExercisesResult.val);
    }
    if (courseSettingsResult.err) {
        return new Err(courseSettingsResult.val);
    }

    const courseDetails = courseDetailsResult.val.course;
    const courseExercises = courseExercisesResult.val;
    const courseSettings = courseSettingsResult.val;

    let availablePoints = 0;
    let awardedPoints = 0;
    courseExercises.forEach((x) => {
        availablePoints += x.available_points.length;
        awardedPoints += x.awarded_points.length;
    });

    const localData: LocalCourseData = {
        description: courseDetails.description || "",
        exercises: courseDetails.exercises.map((e) => ({
            id: e.id,
            name: e.name,
            passed: e.completed,
        })),
        id: courseDetails.id,
        name: courseDetails.name,
        title: courseDetails.title,
        organization: orgAndCourse.val.organization,
        availablePoints: availablePoints,
        awardedPoints: awardedPoints,
        perhapsExamMode: courseSettings.hide_submission_results,
        newExercises: [],
        notifyAfter: 0,
        disabled: courseSettings.disabled_status === "enabled" ? false : true,
        material_url: courseSettings.material_url,
    };
    userData.addCourse(localData);
    resources.createWorkspaceFile(courseDetails.name);
    await displayUserCourses(actionContext);
    return Ok.EMPTY;
}

/**
 * Removes given course from UserData and closes all its exercises.
 * @param id ID of the course to remove
 */
export async function removeCourse(actionContext: ActionContext, id: number): Promise<void> {
    const { userData, workspaceManager, resources } = actionContext;
    const course = userData.getCourse(id);
    Logger.log(`Closing exercises for ${course.name} and removing course data from userData`);
    await closeExercises(
        actionContext,
        course.exercises.map((e) => e.id),
        course.name,
    );
    const exercises = workspaceManager.getExercisesByCourseName(course.name);
    const missingIds = exercises
        .filter((e) => e.status === ExerciseStatus.MISSING)
        .map((e) => e.id);
    Logger.log(`Removing ${missingIds.length} exercise data with Missing status`);
    workspaceManager.deleteExercise(...missingIds);
    fs.removeSync(path.join(resources.getWorkspaceFolderPath(), course.name, ".code-workspace"));
    userData.deleteCourse(id);
}

/**
 * Keeps the user course exercises, points and course data up to date.
 * Refreshes the userData.
 * @param id Course id
 */
export async function updateCourse(actionContext: ActionContext, id: number): Promise<void> {
    const { tmc, userData, workspaceManager } = actionContext;
    return Promise.all([
        tmc.getCourseDetails(id),
        tmc.getCourseExercises(id),
        tmc.getCourseSettings(id),
    ]).then(([courseDetailsResult, courseExercisesResult, courseSettingsResult]) => {
        const showErrorForResult = (endpoint: string, message: string, result: unknown): void => {
            Logger.error(
                `Error refreshing course data for courseId ${id}, ${endpoint} - ${message}`,
                result,
            );
            showError(`Something went wrong while trying to refresh course data: ${message}`);
        };
        const courseToDisable = (id: number): void => {
            Logger.warn(
                `Received 403 Forbidden Authorization Error, disabling course with id ${id}`,
            );
            const course = userData.getCourse(id);
            course.disabled = true;
            userData.updateCourse(course);
        };
        const warnOffline = (message: string): void => {
            Logger.warn(`Didn't fetch course updates, working offline: ${message}`);
        };

        // Check if disabled course still returns error from API
        if (userData.getCourse(id).disabled) {
            Logger.log(`Checking if course with id ${id} still disabled.`);
            if (courseDetailsResult.err || courseExercisesResult.err || courseSettingsResult.err) {
                Logger.log("Course still disabled, can't receive data from API.");
                return;
            }
            Logger.log("Received all necessary data from API, continuing to update course.");
        }

        if (courseDetailsResult.err) {
            const message = `${courseDetailsResult.val.name} - ${courseDetailsResult.val.message}`;
            if (courseDetailsResult.val instanceof AuthorizationError) {
                courseToDisable(id);
                return;
            } else if (courseDetailsResult.val instanceof ConnectionError) {
                warnOffline(message);
                return;
            }
            showErrorForResult("courseDetailsResult", message, courseDetailsResult.val);
            return;
        }
        if (courseExercisesResult.err) {
            const message = `${courseExercisesResult.val.name} - ${courseExercisesResult.val.message}`;
            if (courseExercisesResult.val instanceof AuthorizationError) {
                courseToDisable(id);
                return;
            } else if (courseExercisesResult.val instanceof ConnectionError) {
                warnOffline(message);
                return;
            }
            showErrorForResult("courseExercisesResult", message, courseExercisesResult.val);
            return;
        }
        if (courseSettingsResult.err) {
            const message = `${courseSettingsResult.val.name} - ${courseSettingsResult.val.message}`;
            if (courseSettingsResult.val instanceof AuthorizationError) {
                courseToDisable(id);
                return;
            } else if (courseSettingsResult.val instanceof ConnectionError) {
                warnOffline(message);
                return;
            }
            showErrorForResult("courseSettingsResult", message, courseSettingsResult.val);
            return;
        }

        const details = courseDetailsResult.val.course;
        const exercises = courseExercisesResult.val;
        const settings = courseSettingsResult.val;
        Logger.log(`Refreshing data for course ${details.name} from API`);

        // Update course data
        const courseData = userData.getCourseByName(settings.name);
        courseData.perhapsExamMode = settings.hide_submission_results;
        courseData.description = details.description || "";
        courseData.disabled = settings.disabled_status === "enabled" ? false : true;
        courseData.material_url = settings.material_url;
        userData.updateCourse(courseData);

        // Update course exercise data
        userData.updateExercises(
            id,
            details.exercises.map((x) => ({ id: x.id, name: x.name, passed: x.completed })),
        );
        const [available, awarded] = exercises.reduce(
            (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
            [0, 0],
        );
        userData.updatePoints(id, awarded, available);

        exercises.forEach((ex) => {
            workspaceManager.updateExerciseData(ex.id, ex.soft_deadline, ex.deadline);
        });
    });
}
