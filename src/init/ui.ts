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
import { askForConfirmation, showError, showNotification } from "../api/vscode";
import {
    getPlatform,
    getRustExecutable,
    isCorrectWorkspaceOpen,
    Logger,
    LogLevel,
    sleep,
} from "../utils/";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(actionContext: ActionContext): void {
    const { workspaceManager, ui, resources, settings, vsc, visibilityGroups } = actionContext;
    Logger.log("Initializing UI Actions");

    // Register UI actions
    ui.treeDP.registerAction("Log out", [visibilityGroups.LOGGED_IN], () => {
        logout(actionContext, visibilityGroups);
    });
    ui.treeDP.registerAction("Log in", [visibilityGroups.LOGGED_IN.not], () => {
        ui.webview.setContentFromTemplate({ templateName: "login" });
    });
    ui.treeDP.registerAction("My courses", [visibilityGroups.LOGGED_IN], () => {
        displayUserCourses(actionContext);
    });
    ui.treeDP.registerAction("Settings", [], () => {
        openSettings(actionContext);
    });

    // Register webview handlers
    ui.webview.registerHandler(
        "login",
        async (msg: { type?: "login"; username?: string; password?: string }) => {
            if (!(msg.type && msg.username !== undefined && msg.password !== undefined)) {
                return;
            }
            if (msg.username === "" || msg.password === "") {
                ui.webview.setContentFromTemplate(
                    { templateName: "login", error: "Username or password empty." },
                    true,
                );
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
            const downloads: CourseExerciseDownloads = {
                courseId: msg.courseId,
                exerciseIds: msg.ids,
                organizationSlug: msg.organizationSlug,
                courseName: msg.courseName,
            };
            if (msg.mode === "update") {
                ui.webview.postMessage({
                    key: "course-updates",
                    message: { command: "setUpdateables", exerciseIds: [] },
                });
            }
            const successful = await downloadExercises(actionContext, [downloads]);
            if (successful.length !== 0) {
                if (msg.mode === "download") {
                    await actionContext.userData.clearNewExercises(msg.courseId, successful);
                }
                const openResult = await openExercises(
                    actionContext,
                    successful,
                    downloads.courseName,
                );
                if (openResult.err) {
                    const message = "Failed to open exercises after download.";
                    Logger.error(message, openResult.val);
                    showError(message);
                }
            }
        },
    );
    ui.webview.registerHandler("addCourse", async () => {
        const result = await addNewCourse(actionContext);
        if (result.err) {
            const message = `Failed to add new course: ${result.val.message}`;
            Logger.error(message, result.val);
            showError(message);
        }
    });
    ui.webview.registerHandler(
        "removeCourse",
        async (msg: { type?: "removeCourse"; id?: number }) => {
            if (!(msg.type && msg.id !== undefined)) {
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
    ui.webview.registerHandler(
        "openCourseWorkspace",
        async (msg: { type?: "openCourseWorkspace"; name?: string }) => {
            if (!(msg.type && msg.name)) {
                return;
            }
            openWorkspace(actionContext, msg.name);
        },
    );
    ui.webview.registerHandler(
        "courseDetails",
        async (msg: { type?: "courseDetails"; id?: number; useCache?: boolean }) => {
            if (!(msg.type && msg.id !== undefined)) {
                return;
            }
            const courseId: number = msg.id;
            const uiState = ui.webview.getStateId();

            if (msg.useCache) {
                displayLocalCourseDetails(actionContext, courseId);
            } else {
                updateCourse(actionContext, courseId).then(() =>
                    uiState === ui.webview.getStateId()
                        ? displayLocalCourseDetails(actionContext, courseId)
                        : {},
                );
            }
        },
    );
    ui.webview.registerHandler(
        "openSelected",
        async (msg: { type?: "openSelected"; ids?: number[]; courseName?: string }) => {
            if (!(msg.type && msg.ids && msg.courseName)) {
                return;
            }
            const result = await openExercises(actionContext, msg.ids, msg.courseName);
            if (result.err) {
                const message = "Error while opening exercises.";
                Logger.error(message, result.val);
                showError(message);
            }
        },
    );
    ui.webview.registerHandler(
        "closeSelected",
        async (msg: { type?: "closeSelected"; ids?: number[]; courseName?: string }) => {
            if (!(msg.type && msg.ids && msg.courseName)) {
                return;
            }
            const result = await closeExercises(actionContext, msg.ids, msg.courseName);
            if (result.err) {
                const message = "Error while closing selected exercises.";
                Logger.error(message, result.val);
                showError(message);
            }
        },
    );
    ui.webview.registerHandler("changeTmcDataPath", async (msg: { type?: "changeTmcDataPath" }) => {
        if (!msg.type) {
            return;
        }
        const workspace = vsc.getWorkspaceName();
        const open = workspace ? isCorrectWorkspaceOpen(resources, workspace) : false;
        if (open) {
            showNotification(
                "Please close the TMC workspace from VSCode File menu and try again.",
                ["OK", (): void => {}],
            );
            return;
        }

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
            const res = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "TestMyCode",
                },
                async (p) => {
                    p.report({ message: "Moving TMC Data folder..." });
                    // Have to wait here to allow for the notification to show up.
                    await sleep(50);
                    return workspaceManager.moveFolder(old, newPath);
                },
            );
            if (res.ok) {
                Logger.log(`Moved workspace folder from ${old} to ${newPath}`);
                if (!res.val) {
                    await settings.updateSetting({ setting: "oldDataPath", value: old });
                }
                showNotification(`TMC Data was successfully moved to ${newPath}`, [
                    "OK",
                    (): void => {},
                ]);
                resources.setDataPath(newPath);
                const platform = getPlatform();
                const executable = getRustExecutable(platform);
                const cliPath = path.join(newPath, "cli", executable);
                resources.setCliPath(cliPath);
                await settings.updateSetting({ setting: "dataPath", value: newPath });
            } else {
                Logger.error(res.val);
                showError(res.val.message);
            }
            openSettings(actionContext);
        }
    });

    ui.webview.registerHandler(
        "changeLogLevel",
        async (msg: { type?: "changeLogLevel"; data?: LogLevel }) => {
            if (!(msg.type && msg.data)) {
                return;
            }
            await settings.updateSetting({ setting: "logLevel", value: msg.data });
            Logger.configure(msg.data);
            openSettings(actionContext);
        },
    );

    ui.webview.registerHandler(
        "hideMetaFiles",
        async (msg: { type?: "hideMetaFiles"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            await settings.updateSetting({ setting: "hideMetaFiles", value: msg.data });
            openSettings(actionContext);
        },
    );

    // Temp duplication reducer until all insider toggle commands come from jsx webviews.
    const toggleInsider = async (enabled: boolean): Promise<boolean> => {
        await settings.updateSetting({ setting: "insiderVersion", value: enabled });
        const authenticated = await actionContext.tmc.isAuthenticated();
        if (authenticated.err) {
            showError("Failed to check insider authentication");
            Logger.error("Failed to check insider authentication", authenticated.val);
        }
        ui.treeDP.updateVisibility([
            authenticated.val === true
                ? visibilityGroups.LOGGED_IN
                : visibilityGroups.LOGGED_IN.not,
        ]);
        return enabled;
    };

    ui.webview.registerHandler(
        "insiderVersionLegacy",
        async (msg: { type?: "insiderVersionLegacy"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            await toggleInsider(msg.data);
            await openSettings(actionContext);
        },
    );

    ui.webview.registerHandler(
        "insiderStatus",
        async (msg: { type?: "insiderStatus"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            const enabled = await toggleInsider(msg.data);
            ui.webview.postMessage({
                key: "insiderStatus",
                message: { command: "setInsiderStatus", enabled },
            });
        },
    );

    ui.webview.registerHandler("showLogsToUser", (msg: { type?: "showLogsToUser" }) => {
        if (!msg.type) {
            return;
        }
        Logger.show();
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
