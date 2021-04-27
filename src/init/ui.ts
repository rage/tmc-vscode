import du = require("du");
import { Result } from "ts-results";
import * as vscode from "vscode";

import {
    addNewCourse,
    closeExercises,
    displayLocalCourseDetails,
    displayUserCourses,
    downloadOrUpdateExercises,
    login,
    moveExtensionDataPath,
    openExercises,
    openWorkspace,
    refreshLocalExercises,
    removeCourse,
    selectOrganizationAndCourse,
    updateCourse,
} from "../actions";
import { ActionContext } from "../actions/types";
import { formatSizeInBytes, Logger } from "../utils/";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(actionContext: ActionContext): void {
    const { dialog, ui, resources, settings, userData, visibilityGroups } = actionContext;
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
                const downloadResult = await downloadOrUpdateExercises(
                    actionContext,
                    exerciseDownloads.map((x) => x.exerciseId),
                );
                if (downloadResult.ok) {
                    ui.webview.postMessage({
                        command: "setUpdateables",
                        exerciseIds: downloadResult.val.failed,
                        courseId: msg.courseId,
                    });
                }
                return;
            }

            ui.webview.postMessage({
                command: "setNewExercises",
                courseId: msg.courseId,
                exerciseIds: [],
            });

            const downloadResult = await downloadOrUpdateExercises(actionContext, msg.ids);
            if (downloadResult.err) {
                dialog.errorNotification("Failed to download new exercises.", downloadResult.val);
                return;
            }

            const refreshResult = Result.all(
                await userData.clearFromNewExercises(msg.courseId, downloadResult.val.successful),
                await refreshLocalExercises(actionContext),
            );
            if (refreshResult.err) {
                dialog.errorNotification("Failed to refresh local exercises.", refreshResult.val);
            }

            ui.webview.postMessage({
                command: "setNewExercises",
                courseId: msg.courseId,
                exerciseIds: userData.getCourse(msg.courseId).newExercises,
            });
        },
    );
    ui.webview.registerHandler("addCourse", async () => {
        const orgAndCourse = await selectOrganizationAndCourse(actionContext);
        if (orgAndCourse.err) {
            return dialog.errorNotification(
                `Failed to add new course: ${orgAndCourse.val.message}`,
            );
        }
        const organization = orgAndCourse.val.organization;
        const course = orgAndCourse.val.course;
        const result = await addNewCourse(actionContext, organization, course);
        if (result.err) {
            dialog.errorNotification(`Failed to add new course: ${result.val.message}`);
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
                await dialog.explicitConfirmation(
                    `Do you want to remove ${course.name} from your courses? This won't delete your downloaded exercises.`,
                )
            ) {
                await removeCourse(actionContext, msg.id);
                await displayUserCourses(actionContext);
                dialog.notification(`${course.name} was removed from courses.`);
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
                    dialog.errorNotification(
                        `Failed to update course: ${updateResult.val.message}`,
                        updateResult.val,
                    );
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
                dialog.errorNotification("Errored while opening selected exercises.", result.val);
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
                dialog.errorNotification("Errored while closing selected exercises.", result.val);
            }
        },
    );
    ui.webview.registerHandler("changeTmcDataPath", async (msg: { type?: "changeTmcDataPath" }) => {
        if (!msg.type) {
            return;
        }

        const old = resources.projectsDirectory;
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select folder",
        };
        const newPath = (await vscode.window.showOpenDialog(options))?.[0];
        if (newPath && old) {
            const res = await dialog.progressNotification(
                "Moving projects directory...",
                (progress) => {
                    return moveExtensionDataPath(actionContext, newPath, (update) =>
                        progress.report(update),
                    );
                },
            );
            if (res.ok) {
                Logger.log(`Moved workspace folder from ${old} to ${newPath.fsPath}`);
                dialog.notification(`TMC Data was successfully moved to ${newPath.fsPath}`, [
                    "OK",
                    (): void => {},
                ]);
            } else {
                dialog.errorNotification(res.val.message, res.val);
            }
            ui.webview.postMessage({
                command: "setTmcDataFolder",
                diskSize: formatSizeInBytes(await du(resources.projectsDirectory)),
                path: resources.projectsDirectory,
            });
        }
    });

    ui.webview.registerHandler(
        "insiderStatus",
        async (msg: { type?: "insiderStatus"; data?: boolean }) => {
            if (!(msg.type && msg.data !== undefined)) {
                return;
            }
            await settings.configureIsInsider(!!msg.data);
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
}
