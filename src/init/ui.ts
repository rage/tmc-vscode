import * as _ from "lodash";
import * as path from "path";
import * as vscode from "vscode";

import {
    addNewCourse,
    closeExercises,
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
import { ExerciseStatus } from "../config/types";
import {
    askForConfirmation,
    isWorkspaceOpen,
    LogLevel,
    showError,
    showNotification,
} from "../utils/";

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

    // Register UI actions
    ui.treeDP.registerAction("Log out", [LOGGED_IN], () => {
        logout(actionContext, visibilityGroups);
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
    // TODO: Split download and update in more sensible way
    ui.webview.registerHandler(
        "downloadExercises",
        async (msg: {
            type?: "downloadExercises";
            ids?: number[];
            courseName?: string;
            organizationSlug?: string;
            courseId?: number;
            mode?: string;
        }) => {
            if (
                !(
                    msg.type &&
                    msg.ids &&
                    msg.courseName &&
                    msg.organizationSlug &&
                    msg.courseId &&
                    msg.mode
                )
            ) {
                return;
            }
            const openAfter = msg.ids.filter(
                (id) =>
                    workspaceManager.getExerciseDataById(id).mapErr(() => undefined).val?.status !==
                    ExerciseStatus.CLOSED,
            );
            const downloads: CourseExerciseDownloads = {
                courseId: msg.courseId,
                exerciseIds: msg.ids,
                organizationSlug: msg.organizationSlug,
            };
            if (msg.mode === "download") {
                await actionContext.userData.clearNewExercises(msg.courseId);
            } else if (msg.mode === "update") {
                ui.webview.postMessage({
                    key: "course-updates",
                    message: { command: "setUpdateables", exerciseIds: [] },
                });
            }
            const successful = await downloadExercises(actionContext, [downloads]);
            openExercises(actionContext, _.intersection(openAfter, successful));
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
                await removeCourse(actionContext, msg.id);
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
        displayLocalCourseDetails(actionContext, msg.id);
        const uiState = ui.webview.getStateId();
        // Try to fetch updates from API
        updateCourse(actionContext, courseId).then(() =>
            uiState === ui.webview.getStateId()
                ? displayLocalCourseDetails(actionContext, courseId)
                : {},
        );
    });
    ui.webview.registerHandler(
        "openSelected",
        async (msg: { type?: "openSelected"; ids?: number[] }) => {
            if (!(msg.type && msg.ids)) {
                return;
            }
            const result = await openExercises(actionContext, msg.ids);
            if (result.err) {
                logger.error(`Error while opening exercises - ${result.val.message}`);
                const buttons: Array<[string, () => void]> = [];
                settings.getLogLevel() !== LogLevel.None
                    ? buttons.push(["Open logs", (): void => actionContext.logger.show()])
                    : buttons.push(["Ok", (): void => {}]);
                showError(`${result.val.name} - ${result.val.message}`, ...buttons);
            }
        },
    );
    ui.webview.registerHandler(
        "closeSelected",
        async (msg: { type?: "closeSelected"; ids?: number[] }) => {
            if (!(msg.type && msg.ids)) {
                return;
            }
            const result = await closeExercises(actionContext, msg.ids);
            if (result.err) {
                logger.error(`Error while closing exercises - ${result.val.message}`);
                const buttons: Array<[string, () => void]> = [];
                settings.getLogLevel() !== LogLevel.None
                    ? buttons.push(["Open logs", (): void => actionContext.logger.show()])
                    : buttons.push(["Ok", (): void => {}]);
                showError(`${result.val.name} - ${result.val.message}`, ...buttons);
            }
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
                        "Some files could not be removed from the previous workspace directory." +
                            `They will have to be removed manually. ${old}`,
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

    ui.webview.registerHandler(
        "hideMetaFiles",
        (msg: { type?: "hideMetaFiles"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            settings.updateSetting({ setting: "hideMetaFiles", value: msg.data });
            openSettings(actionContext);
        },
    );

    ui.webview.registerHandler("showLogsToUser", (msg: { type?: "showLogsToUser" }) => {
        if (!msg.type) {
            return;
        }
        logger.show();
    });

    ui.webview.registerHandler("openEditorDirection", (msg: { type?: "openEditorDirection" }) => {
        if (!msg.type) {
            return;
        }
        const search = "workbench.editor.openSideBySideDirection";
        // openWorkspaceSettings doesn't take search params:
        // https://github.com/microsoft/vscode/issues/90086
        vscode.commands.executeCommand("workbench.action.openSettings", search);
    });
}
