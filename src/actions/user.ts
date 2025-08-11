/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that respond to the user.
 * -------------------------------------------------------------------------------------------------
 */

import * as fs from "fs-extra";
import * as _ from "lodash";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import {
    WorkspaceExercise,
    WorkspaceExercise as WorkspaceTmcExercise,
} from "../api/workspaceManager";
import { EXAM_TEST_RESULT, NOTIFICATION_DELAY } from "../config/constants";
import { BottleneckError } from "../errors";
import { randomPanelId, TmcPanel } from "../panels/TmcPanel";
import {
    CourseIdentifier,
    ExerciseSubmissionPanel,
    ExerciseTestsPanel,
    TestResultData,
    LocalCourseData,
    LocalCourseExercise,
} from "../shared/shared";
import { Logger, parseFeedbackQuestion } from "../utilities/";
import { getActiveEditorExecutablePath } from "../window";

import { downloadNewExercisesForCourse } from "./downloadNewExercisesForCourse";
import { ActionContext } from "./types";
import { updateCourse } from "./updateCourse";

export const testInterrupts: Map<number, Array<() => void>> = new Map();

/**
 * Authenticates and logs the user in if credentials are correct.
 */
export async function login(
    actionContext: ActionContext,
    username: string,
    password: string,
): Promise<Result<void, Error>> {
    const { langs, dialog } = actionContext;
    if (langs.err) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Logging in");

    if (!username || !password) {
        return new Err(new Error("Username and password may not be empty."));
    }

    const result = await langs.val.authenticate(username, password);
    if (result.err) {
        dialog.errorNotification(`Failed to log in: "${result.val.message}:"`, result.val);
        return result;
    }

    return Ok.EMPTY;
}

/**
 * Logs the user out, updating UI state
 */
export async function logout(actionContext: ActionContext): Promise<Result<void, Error>> {
    const { langs, dialog } = actionContext;
    if (langs.err) {
        return new Err(new Error("Extension was not initialized properly"));
    }

    const result = await langs.val.deauthenticate();
    if (result.err) {
        dialog.errorNotification(`Failed to log out: "${result.val.message}:"`, result.val);
        return result;
    }

    return Ok.EMPTY;
}

/**
 * Tests an exercise while keeping the user informed
 */
export async function testExercise(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
    exercise: WorkspaceTmcExercise,
): Promise<Result<void, Error>> {
    const { langs, userData } = actionContext;
    if (!(langs.ok && userData.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }

    const course = userData.val.getCourseBySlug(exercise.courseSlug);
    const courseExercise = LocalCourseData.getExercises(course).find(
        (x) => LocalCourseExercise.getSlug(x) === exercise.exerciseSlug,
    );
    if (!courseExercise) {
        return Err(
            new Error(
                `ID for exercise ${exercise.courseSlug}/${exercise.exerciseSlug} was not found.`,
            ),
        );
    }

    const testRunId = randomPanelId();
    // render panel
    const panel: ExerciseTestsPanel = {
        id: randomPanelId(),
        type: "ExerciseTests",
        course: course,
        exercise: courseExercise,
        exerciseUri: exercise.uri,
        testRunId,
    };
    await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel);

    let data: TestResultData = {
        ...EXAM_TEST_RESULT,
        id: LocalCourseExercise.getId(courseExercise),
        disabled: course.data.disabled,
        courseSlug: LocalCourseData.getCourseName(course),
    };

    if (!course.data.perhapsExamMode) {
        const executablePath = getActiveEditorExecutablePath(actionContext);
        const [testRunner, testInterrupt] = langs.val.runTests(exercise.uri.fsPath, executablePath);
        const [validationRunner, validationInterrupt] = langs.val.runCheckstyle(
            exercise.uri.fsPath,
        );
        testInterrupts.set(testRunId, [testInterrupt, validationInterrupt]);
        const exerciseName = exercise.exerciseSlug;

        Logger.info(`Running local tests and validations for ${exerciseName}`);
        const testResults = await testRunner;
        Logger.info(`Tests finished for ${exerciseName}`);

        if (testResults.err) {
            TmcPanel.postMessage({
                type: "testError",
                target: panel,
                error: testResults.val,
            });
            return Ok.EMPTY;
        }

        const validationResults = await validationRunner;
        Logger.info(`Validations finished for ${exerciseName}`);

        if (validationResults.err) {
            TmcPanel.postMessage({
                type: "testError",
                target: panel,
                error: validationResults.val,
            });
            return Ok.EMPTY;
        }

        data = {
            testResult: testResults.val,
            id: LocalCourseExercise.getId(courseExercise),
            courseSlug: LocalCourseData.getCourseName(course),
            exerciseName,
            tmcLogs: testResults.val.logs,
            disabled: course.data.disabled,
            styleValidationResult: validationResults.val,
        };

        if (TmcPanel.sidePanel === undefined) {
            // user closed panel, re-render
            await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel);
        }
        TmcPanel.postMessage({
            type: "testResults",
            target: panel,
            testResults: data,
        });
    } else {
        // exam
        TmcPanel.postMessage({
            type: "willNotRunTestsForExam",
            target: panel,
        });
    }

    return Ok.EMPTY;
}

/**
 * Submits an exercise while keeping the user informed
 * @param tempView Existing TemporaryWebview to use if any
 */
export async function submitTmcExercise(
    context: vscode.ExtensionContext,
    actionContext: ActionContext,
    exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
    const { exerciseDecorationProvider, langs, userData } = actionContext;
    if (!(langs.ok && userData.ok && exerciseDecorationProvider.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info(`Submitting exercise ${exercise.exerciseSlug} to server`);

    const course = userData.val.getCourseBySlug(exercise.courseSlug);
    const courseExercise = LocalCourseData.getExercises(course).find(
        (x) => LocalCourseExercise.getSlug(x) === exercise.exerciseSlug,
    );
    if (!courseExercise) {
        return Err(
            new Error(
                `ID for exercise ${exercise.exerciseSlug}/${exercise.exerciseSlug} was not found.`,
            ),
        );
    }

    const panel: ExerciseSubmissionPanel = {
        id: randomPanelId(),
        type: "ExerciseSubmission",
        course,
        exercise: courseExercise,
    };
    await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel);

    const submissionResult = await langs.val.submitExerciseAndWaitForResults(
        LocalCourseExercise.getId(courseExercise),
        exercise.uri.fsPath,
        (progressPercent, message) => {
            TmcPanel.postMessage({
                type: "submissionStatusUpdate",
                target: panel,
                progressPercent,
                message,
            });
        },
        (url) => {
            TmcPanel.postMessage({
                type: "submissionStatusUrl",
                target: panel,
                url,
            });
        },
    );

    if (submissionResult.err) {
        if (submissionResult.val instanceof BottleneckError) {
            Logger.warn("Submission was cancelled:", submissionResult.val);
            return Ok.EMPTY;
        }
        TmcPanel.postMessage({
            type: "submissionStatusError",
            target: panel,
            error: submissionResult.val,
        });
        return submissionResult;
    }

    const statusData = submissionResult.val;
    if (statusData.status === "ok" && statusData.all_tests_passed) {
        userData.val.setExerciseAsPassed(exercise.courseSlug, exercise.exerciseSlug).then(() => {
            exerciseDecorationProvider.val.updateDecorationsForExercises(exercise);
        });
    }
    const questions = statusData.feedback_questions
        ? parseFeedbackQuestion(statusData.feedback_questions)
        : [];
    if (TmcPanel.sidePanel === undefined) {
        await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel);
    }
    TmcPanel.postMessage({
        type: "submissionResult",
        target: panel,
        result: statusData,
        questions,
    });

    const courseData = userData.val.getCourse(
        LocalCourseData.getCourseId(panel.course),
    ) as Readonly<LocalCourseData>;
    const courseId = LocalCourseData.getCourseId(courseData);
    await checkForCourseUpdates(actionContext, courseId);
    vscode.commands.executeCommand("tmc.updateExercises", "silent");

    return Ok.EMPTY;
}

/**
 * Sends the exercise to the TMC Paste server.
 * @param id Exercise ID
 * @returns TMC Paste link if the action was successful.
 */
export async function pasteTmcExercise(
    actionContext: ActionContext,
    courseSlug: string,
    exerciseName: string,
): Promise<Result<string, Error>> {
    const { langs, userData, workspaceManager, dialog } = actionContext;
    if (!(langs.ok && userData.ok && workspaceManager.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }

    const exerciseId = userData.val.getTmcExerciseByName(courseSlug, exerciseName)?.id;
    const exercisePath = workspaceManager.val.getExerciseBySlug("tmc", courseSlug, exerciseName)
        ?.uri.fsPath;
    if (!exerciseId || !exercisePath) {
        return Err(new Error("Failed to resolve exercise id"));
    }

    const pasteResult = await langs.val.submitTmcExerciseToPaste(exerciseId, exercisePath);
    if (pasteResult.err) {
        dialog.errorNotification(
            `Failed to send exercise to TMC Paste: ${pasteResult.val.message}.`,
            pasteResult.val,
        );
        return pasteResult;
    }

    const pasteLink = pasteResult.val;
    if (pasteLink === "") {
        const message = "Didn't receive paste link from server.";
        return new Err(new Error(`Failed to send exercise to TMC Paste: ${message}`));
    }

    return new Ok(pasteLink);
}

export async function pasteMoocExercise(
    actionContext: ActionContext,
    courseSlug: string,
    exerciseName: string,
): Promise<Result<string, Error>> {
    const { langs, userData, workspaceManager, dialog } = actionContext;
    if (!(langs.ok && userData.ok && workspaceManager.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }

    const exerciseId = userData.val.getMoocExerciseByName(courseSlug, exerciseName)?.id;
    const exercisePath = workspaceManager.val.getExerciseBySlug("tmc", courseSlug, exerciseName)
        ?.uri.fsPath;
    if (!exerciseId || !exercisePath) {
        return Err(new Error("Failed to resolve exercise id"));
    }

    const pasteResult = await langs.val.submitMoocExerciseToPaste(exerciseId, exercisePath);
    if (pasteResult.err) {
        dialog.errorNotification(
            `Failed to send exercise to TMC Paste: ${pasteResult.val.message}.`,
            pasteResult.val,
        );
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
    courseId?: CourseIdentifier,
): Promise<void> {
    const { dialog, userData } = actionContext;
    if (userData.err) {
        Logger.error("Extension was not initialized properly");
        return;
    }
    const courses = courseId ? [userData.val.getCourse(courseId)] : userData.val.getCourses();

    const filteredCourses = courses.filter((c) => c.data.notifyAfter <= Date.now());
    Logger.info(`Checking for course updates for courses`);
    const updatedCourses: LocalCourseData[] = [];
    for (const course of filteredCourses) {
        const courseId = LocalCourseData.getCourseId(course);
        await updateCourse(actionContext, courseId);
        updatedCourses.push(userData.val.getCourse(courseId));
    }

    const handleDownload = async (course: LocalCourseData): Promise<void> => {
        const courseId = LocalCourseData.getCourseId(course);
        const downloadResult = await downloadNewExercisesForCourse(actionContext, courseId);
        if (downloadResult.err) {
            dialog.errorNotification(
                `Failed to download new exercises for course"`,
                downloadResult.val,
            );
        }
    };

    for (const course of updatedCourses) {
        const newExercises = LocalCourseData.getNewExercises(course);
        if (newExercises.length > 0 && !course.data.disabled) {
            const courseId = LocalCourseData.getCourseId(course);
            const courseName = LocalCourseData.getCourseName(course);
            dialog.notification(
                `Found ${newExercises.length} new exercises for ${courseName}. Do you wish to download them now?`,
                ["Download", async (): Promise<void> => handleDownload(course)],
                [
                    "Remind me later",
                    (): void => {
                        userData.val.setNotifyDate(courseId, Date.now() + NOTIFICATION_DELAY);
                    },
                ],
                [
                    "Don't remind about these exercises",
                    (): void => {
                        userData.val.clearFromNewExercises(courseId);
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
    const { dialog, resources, workspaceManager } = actionContext;
    if (!(resources.ok && workspaceManager.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const currentWorkspaceFile = vscode.workspace.workspaceFile;
    const tmcWorkspaceFile = resources.val.getWorkspaceFilePath(name);
    const workspaceAsUri = vscode.Uri.file(tmcWorkspaceFile);
    Logger.info(`Current workspace: ${currentWorkspaceFile?.fsPath}`);
    Logger.info(`TMC workspace: ${tmcWorkspaceFile}`);

    if (!(currentWorkspaceFile?.toString() === tmcWorkspaceFile.toString())) {
        if (
            !currentWorkspaceFile ||
            (await dialog.confirmation(
                "Do you want to open TMC workspace and close the current one?",
            ))
        ) {
            if (!fs.existsSync(tmcWorkspaceFile)) {
                workspaceManager.val.createWorkspaceFile(name);
            }
            await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
            // Restarts VSCode
        } else {
            const choice = "Close current & open Course Workspace";
            await dialog.warningNotification(
                "Please close the current workspace before opening a course workspace.",
                [
                    choice,
                    async (): Promise<Thenable<unknown>> => {
                        if (!fs.existsSync(tmcWorkspaceFile)) {
                            workspaceManager.val.createWorkspaceFile(name);
                        }
                        return vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
                    },
                ],
            );
        }
    } else if (currentWorkspaceFile?.fsPath === tmcWorkspaceFile) {
        Logger.info("Workspace already open, changing focus to this workspace.");
        await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri);
        await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer");
    }
}

/**
 * Removes given course from UserData and removes its associated files. However, doesn't remove any
 * exercises that are on disk.
 *
 * @param id ID of the course to remove
 */
export async function removeCourse(
    actionContext: ActionContext,
    id: CourseIdentifier,
): Promise<void> {
    const { langs, ui, userData, workspaceManager, dialog } = actionContext;
    if (!(langs.ok && userData.ok && workspaceManager.ok)) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const course = userData.val.getCourse(id);
    const courseName = LocalCourseData.getCourseName(course);
    Logger.info(`Closing exercises for ${courseName} and removing course data from userData`);

    const unsetResult = await langs.val.unsetSetting(`closed-exercises-for:${courseName}`);
    if (unsetResult.err) {
        dialog.errorNotification(
            `Failed to remove TMC-langs data for "${courseName}:"`,
            unsetResult.val,
        );
    }

    userData.val.deleteCourse(id);
    ui.treeDP.removeChildWithId("myCourses", id.toString());

    if (workspaceManager.val.activeCourse === courseName) {
        Logger.info("Closing course workspace because it was removed.");
        await vscode.commands.executeCommand("workbench.action.closeFolder");
    }
}
