import * as vscode from "vscode";
import * as path from "path";

import { askForConfirmation, isWorkspaceOpen, showError, showNotification } from "../utils/";
import {
    addNewCourse,
    closeExercises,
    displayCourseDownloads,
    displayLocalCourseDetails,
    displayUserCourses,
    downloadExercises,
    login,
    logout,
    openExercises,
    openSettings,
    openWorkspace,
    removeCourse,
    updateCourse,
} from "../actions";
import { ActionContext, CourseExerciseDownloads } from "../actions/types";
import { LogLevel } from "../utils/logger";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(actionContext: ActionContext): void {
    const { tmc, workspaceManager, ui, resources, logger, settings } = actionContext;
    logger.log("Initializing UI Actions");
    const LOGGED_IN = ui.treeDP.createVisibilityGroup(tmc.isAuthenticated());
    const WORKSPACE_OPEN = ui.treeDP.createVisibilityGroup(isWorkspaceOpen(resources));

    const visibilityGroups = {
        LOGGED_IN,
        WORKSPACE_OPEN,
    };

    // Register UI actionS
    ui.treeDP.registerAction("Log out", [LOGGED_IN], () => {
        logout(visibilityGroups, actionContext);
    });
    ui.treeDP.registerAction("Log in", [LOGGED_IN.not], () => {
        ui.webview.setContentFromTemplate({ templateName: "login" });
    });
    ui.treeDP.registerAction("My courses", [LOGGED_IN], () => {
        displayUserCourses(actionContext);
    });
    ui.treeDP.registerAction("Open exercise workspace", [WORKSPACE_OPEN.not], () => {
        openWorkspace(actionContext);
    });
    ui.treeDP.registerAction("Settings", [], () => {
        openSettings(actionContext);
    });

    // Register webview handlers
    ui.webview.registerHandler(
        "login",
        async (msg: { type?: "login"; username?: string; password?: string }) => {
            if (!(msg.type && msg.username && msg.password)) {
                return;
            }
            const result = await login(actionContext, msg.username, msg.password, visibilityGroups);
            if (result.err) {
                ui.webview.setContentFromTemplate(
                    { templateName: "login", error: result.val.message },
                    true,
                );
                return;
            }
            displayUserCourses(actionContext);
        },
    );
    ui.webview.registerHandler("myCourses", () => {
        displayUserCourses(actionContext);
    });
    ui.webview.registerHandler(
        "downloadExercises",
        async (msg: {
            type?: "downloadExercises";
            ids?: number[];
            courseName?: string;
            organizationSlug?: string;
            courseId?: number;
        }) => {
            if (!(msg.type && msg.ids && msg.courseName && msg.organizationSlug && msg.courseId)) {
                return;
            }
            const downloads: CourseExerciseDownloads = {
                courseId: msg.courseId,
                exerciseIds: msg.ids,
                organizationSlug: msg.organizationSlug,
            };
            await actionContext.userData.clearNewExercises(msg.courseId);
            await downloadExercises(actionContext, [downloads], msg.courseId);
            workspaceManager.openExercise(...msg.ids);
        },
    );
    ui.webview.registerHandler("addCourse", async () => {
        const result = await addNewCourse(actionContext);
        if (result.err) {
            const message = `Failed to add new course: ${result.val.message}`;
            logger.error(message);
            showError(message);
        }
    });
    ui.webview.registerHandler(
        "exerciseDownloads",
        async (msg: { type?: "exerciseDownloads"; id?: number }) => {
            if (!(msg.type && msg.id)) {
                return;
            }
            const res = await displayCourseDownloads(actionContext, msg.id);
            if (res.err) {
                const message = `Can't display downloads: ${res.val.message}`;
                logger.error(message);
                showError(message);
            }
        },
    );
    ui.webview.registerHandler(
        "removeCourse",
        async (msg: { type?: "removeCourse"; id?: number }) => {
            if (!(msg.type && msg.id)) {
                return;
            }
            const course = actionContext.userData.getCourse(msg.id);
            if (
                await askForConfirmation(
                    `Do you want to remove ${course.name} from your courses? This won't delete your downloaded exercises.`,
                    true,
                )
            ) {
                await removeCourse(msg.id, actionContext);
                await displayUserCourses(actionContext);
                showNotification(`${course.name} was removed from courses.`);
            }
        },
    );
    ui.webview.registerHandler("courseDetails", (msg: { type?: "courseDetails"; id?: number }) => {
        if (!(msg.type && msg.id)) {
            return;
        }
        const courseId: number = msg.id;
        displayLocalCourseDetails(msg.id, actionContext);
        const uiState = ui.webview.getStateId();
        // Try to fetch updates from API
        updateCourse(courseId, actionContext).then(() =>
            uiState === ui.webview.getStateId()
                ? displayLocalCourseDetails(courseId, actionContext)
                : {},
        );
    });
    ui.webview.registerHandler(
        "openSelected",
        async (msg: { type?: "openSelected"; ids?: number[]; id?: number }) => {
            if (!(msg.type && msg.ids && msg.id)) {
                return;
            }
            actionContext.ui.webview.setContentFromTemplate({ templateName: "loading" });
            await openExercises(msg.ids, actionContext);
            displayLocalCourseDetails(msg.id, actionContext);
        },
    );
    ui.webview.registerHandler(
        "closeSelected",
        async (msg: { type?: "closeSelected"; ids?: number[]; id?: number }) => {
            if (!(msg.type && msg.ids && msg.id)) {
                return;
            }
            actionContext.ui.webview.setContentFromTemplate({ templateName: "loading" });
            await closeExercises(actionContext, msg.ids);
            displayLocalCourseDetails(msg.id, actionContext);
        },
    );
    ui.webview.registerHandler("changeTmcDataPath", async (msg: { type?: "changeTmcDataPath" }) => {
        if (!msg.type) {
            return;
        }

        const open = isWorkspaceOpen(resources);

        const old = resources.getDataPath();
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select folder",
        };
        const uri = await vscode.window.showOpenDialog(options);
        if (uri && old) {
            const newPath = path.join(uri[0].fsPath, "/tmcdata");
            if (newPath === old) {
                return;
            }
            const res = await workspaceManager.moveFolder(old, newPath);
            if (res.ok) {
                logger.log(`Moved workspace folder from ${old} to ${newPath}`);
                if (!res.val) {
                    showNotification(
                        `Some files could not be removed from the previous workspace directory. They will have to be removed manually. ${old}`,
                        ["OK", (): void => {}],
                    );
                }
                showNotification(`TMC Data was successfully moved to ${newPath}`, [
                    "OK",
                    (): void => {},
                ]);
                resources.setDataPath(newPath);
                settings.updateSetting({ setting: "dataPath", value: newPath });
                if (open) {
                    // Opening a workspace restarts VSCode (v1.44)
                    vscode.commands.executeCommand(
                        "vscode.openFolder",
                        vscode.Uri.file(
                            path.join(newPath, "TMC workspace", "TMC Exercises.code-workspace"),
                        ),
                    );
                }
            } else {
                logger.error(res.val.message);
                showError(res.val.message);
            }
            workspaceManager.restartWatcher();
            openSettings(actionContext);
        }
    });

    ui.webview.registerHandler(
        "changeLogLevel",
        (msg: { type?: "changeLogLevel"; data?: LogLevel }) => {
            if (!(msg.type && msg.data)) {
                return;
            }
            settings.updateSetting({ setting: "logLevel", value: msg.data });
            logger.setLogLevel(msg.data);
            openSettings(actionContext);
        },
    );
}
