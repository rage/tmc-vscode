import du = require("du");
import * as _ from "lodash";
import * as path from "path";
import * as vscode from "vscode";

import {
    addNewCourse,
    closeExercises,
    displayLocalCourseDetails,
    displayUserCourses,
    downloadExercises,
    downloadExerciseUpdates,
    login,
    openExercises,
    openWorkspace,
    removeCourse,
    updateCourse,
} from "../actions";
import { ActionContext } from "../actions/types";
import { formatSizeInBytes, isCorrectWorkspaceOpen, Logger, LogLevel, sleep } from "../utils/";
import { askForConfirmation, showError, showNotification } from "../window";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(actionContext: ActionContext): void {
    const { workspaceManager, ui, resources, settings, visibilityGroups } = actionContext;
    Logger.log("Initializing UI Actions");

    // Register UI actions
    ui.treeDP.registerAction("Log in", "logIn", [visibilityGroups.loggedIn.not], {
        command: "tmcTreeView.setContentFromTemplate",
        title: "",
        arguments: [{ templateName: "login" }],
    });

    const userCourses = actionContext.userData.getCourses();
    ui.treeDP.registerAction(
        "My Courses",
        "myCourses",
        [visibilityGroups.loggedIn],
        {
            command: "tmc.myCourses",
            title: "Go to My Courses",
        },
        userCourses.length !== 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
        userCourses.map<{ label: string; id: string; command: vscode.Command }>((course) => ({
            label: course.title,
            id: course.id.toString(),
            command: {
                command: "tmc.courseDetails",
                title: "Go to course details",
                arguments: [course.id],
            },
        })),
    );

    ui.treeDP.registerAction("Settings", "settings", [], {
        command: "tmc.openSettings",
        title: "Go to TMC Settings",
    });
    ui.treeDP.registerAction("Open TMC Exercises Folder", "tmcDataFolder", [], {
        command: "tmc.openTMCExercisesFolder",
        title: "Open TMC Exercises Folder",
    });
    ui.treeDP.registerAction("Log out", "logOut", [visibilityGroups.loggedIn], {
        command: "tmc.logout",
        title: "Log out",
    });

    // Register webview handlers
    ui.webview.registerHandler(
        "login",
        async (msg: { type?: "login"; username?: string; password?: string }) => {
            if (!(msg.type && msg.username !== undefined && msg.password !== undefined)) {
                return;
            }
            if (msg.username === "" || msg.password === "") {
                ui.webview.postMessage({
                    command: "loginError",
                    error: "Username or password empty.",
                });
                return;
            }
            const result = await login(actionContext, msg.username, msg.password);
            if (result.err) {
                ui.webview.postMessage({ command: "loginError", error: result.val.message });
                return;
            }
            displayUserCourses(actionContext);
        },
    );
    ui.webview.registerHandler("myCourses", () => {
        displayUserCourses(actionContext);
    });

    ui.webview.registerHandler(
        "clearNewExercises",
        (msg: { type?: "clearNewExercises"; courseId?: number }) => {
            if (!(msg.type && msg.courseId)) {
                return;
            }
            actionContext.userData.clearFromNewExercises(msg.courseId);
        },
    );

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
            const exerciseDownloads = msg.ids.map((x) => ({
                courseId: msg.courseId as number,
                exerciseId: x,
                organization: msg.organizationSlug as string,
            }));
            if (msg.mode === "update") {
                ui.webview.postMessage({
                    command: "setUpdateables",
                    exerciseIds: [],
                    courseId: msg.courseId,
                });
                const [successful] = await downloadExerciseUpdates(
                    actionContext,
                    exerciseDownloads,
                );
                const remaining = _.difference(
                    msg.ids,
                    successful.map((x) => x.exerciseId),
                );
                ui.webview.postMessage({
                    command: "setUpdateables",
                    exerciseIds: remaining,
                    courseId: msg.courseId,
                });
                return;
            }
            const { downloaded } = await downloadExercises(
                actionContext,
                msg.ids.map((x) => ({ id: x, courseName: msg.courseName as string })),
            );
            if (downloaded.length !== 0) {
                await actionContext.userData.clearFromNewExercises(msg.courseId, downloaded);
                const openResult = await openExercises(actionContext, downloaded, msg.courseName);
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
                const updateResult = await updateCourse(actionContext, courseId);
                if (updateResult.err) {
                    Logger.error("Failed to update course", updateResult.val);
                    showError(`Failed to update course: ${updateResult.val.message}`);
                }
                if (uiState === ui.webview.getStateId()) {
                    displayLocalCourseDetails(actionContext, courseId);
                }
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
        const workspace = vscode.workspace.name?.split(" ")[0];
        const open = workspace ? isCorrectWorkspaceOpen(resources, workspace) : false;
        if (open) {
            showNotification(
                "Please close the TMC workspace from VSCode File menu and try again.",
                ["OK", (): void => {}],
            );
            return;
        }

        const old = resources.projectsDirectory;
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
                resources.projectsDirectory = newPath;
                await settings.updateSetting({ setting: "dataPath", value: newPath });
            } else {
                Logger.error(res.val);
                showError(res.val.message);
            }
            ui.webview.postMessage({
                command: "setTmcDataFolder",
                diskSize: formatSizeInBytes(await du(resources.projectsDirectory)),
                path: newPath,
            });
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
            ui.webview.postMessage({ command: "setLogLevel", level: msg.data });
        },
    );

    ui.webview.registerHandler(
        "hideMetaFiles",
        async (msg: { type?: "hideMetaFiles"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            await settings.updateSetting({ setting: "hideMetaFiles", value: msg.data });
            ui.webview.postMessage({
                command: "setBooleanSetting",
                setting: "hideMetaFiles",
                enabled: msg.data,
            });
        },
    );

    ui.webview.registerHandler(
        "insiderStatus",
        async (msg: { type?: "insiderStatus"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            await settings.updateSetting({ setting: "insiderVersion", value: msg.data });
            ui.webview.postMessage({
                command: "setBooleanSetting",
                setting: "insider",
                enabled: msg.data,
            });
        },
    );

    ui.webview.registerHandler("showLogsToUser", (msg: { type?: "showLogsToUser" }) => {
        if (!msg.type) {
            return;
        }
        Logger.show();
    });

    ui.webview.registerHandler("openLogsFolder", (msg: { type?: "openLogsFolder" }) => {
        if (!msg.type) {
            return;
        }
        vscode.commands.executeCommand("workbench.action.openExtensionLogsFolder");
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

    ui.webview.registerHandler(
        "downloadOldSubmissionSetting",
        async (msg: { type?: "downloadOldSubmissionSetting"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            await settings.updateSetting({ setting: "downloadOldSubmission", value: msg.data });
            ui.webview.postMessage({
                command: "setBooleanSetting",
                setting: "downloadOldSubmission",
                enabled: msg.data,
            });
        },
    );

    ui.webview.registerHandler(
        "updateExercisesAutomaticallySetting",
        async (msg: { type?: "updateExercisesAutomaticallySetting"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            await settings.updateSetting({
                setting: "updateExercisesAutomatically",
                value: msg.data,
            });
            ui.webview.postMessage({
                command: "setBooleanSetting",
                setting: "updateExercisesAutomatically",
                enabled: msg.data,
            });
        },
    );
}
