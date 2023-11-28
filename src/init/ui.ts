import { compact } from "lodash";
import { Result } from "ts-results";
import * as vscode from "vscode";

import {
    addNewCourse,
    closeExercises,
    displayLocalCourseDetails,
    displayUserCourses,
    downloadOrUpdateExercises,
    login,
    openExercises,
    openWorkspace,
    refreshLocalExercises,
    removeCourse,
    selectOrganizationAndCourse,
    updateCourse,
} from "../actions";
import { ActionContext } from "../actions/types";
import { TmcPanel } from "../panels/TmcPanel";
import { ExtensionToWebview } from "../shared/shared";
import UI from "../ui/ui";
import { Logger } from "../utilities/";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(actionContext: ActionContext): void {
    const { dialog, ui, settings, userData, visibilityGroups } = actionContext;
    Logger.info("Initializing UI Actions");

    // Register UI actions
    ui.treeDP.registerAction("Log in", "logIn", [visibilityGroups.loggedIn.not], {
        command: "tmc.showLogin",
        title: "",
        arguments: [],
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

    ui.webview.registerHandler("changeTmcDataPath", async (msg: { type?: "changeTmcDataPath" }) => {
        if (!msg.type) {
            return;
        }
        await vscode.commands.executeCommand("tmc.changeTmcDataPath");
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
            await uiDownloadExercises(ui, actionContext, msg.mode, msg.courseId, msg.ids);
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
        "openExercises",
        async (msg: { type?: "openExercises"; ids?: number[]; courseName?: string }) => {
            if (!(msg.type && msg.ids && msg.courseName)) {
                return;
            }

            // download exercises that don't exist locally
            const course = userData.getCourseByName(msg.courseName);
            const courseExercises = new Map(course.exercises.map((x) => [x.id, x]));
            const exercisesToOpen = compact(msg.ids.map((x) => courseExercises.get(x)));
            const localCourseExercises = await actionContext.tmc.listLocalCourseExercises(
                msg.courseName,
            );
            if (localCourseExercises.err) {
                dialog.errorNotification(
                    `Error trying to list local exercises while opening selected exercises. ${localCourseExercises.val}`,
                );
                return;
            }
            const localCourseExerciseSlugs = localCourseExercises.val.map(
                (lce) => lce["exercise-slug"],
            );
            const exercisesToDownload = exercisesToOpen.filter(
                (eto) => !localCourseExerciseSlugs.includes(eto.name),
            );
            if (exercisesToDownload.length !== 0) {
                await uiDownloadExercises(
                    ui,
                    actionContext,
                    "",
                    course.id,
                    exercisesToDownload.map((etd) => etd.id),
                );
            }

            // now, actually open the exercises
            const result = await openExercises(actionContext, msg.ids, msg.courseName);
            if (result.err) {
                dialog.errorNotification("Errored while opening selected exercises.", result.val);
            }
            ui.webview.postMessage({
                command: "setNewExercises",
                courseId: course.id,
                exerciseIds: userData.getCourse(course.id).newExercises,
            });
        },
    );
    ui.webview.registerHandler(
        "closeExercises",
        async (msg: { type?: "closeExercises"; ids?: number[]; courseName?: string }) => {
            if (!(msg.type && msg.ids && msg.courseName)) {
                return;
            }
            const result = await closeExercises(actionContext, msg.ids, msg.courseName);
            if (result.err) {
                dialog.errorNotification("Errored while closing selected exercises.", result.val);
            }
            const messages: Array<ExtensionToWebview> = msg.ids.map((id) => {
                return {
                    type: "exerciseStatusChange",
                    exerciseId: id,
                    status: "closed",
                    target: {
                        type: "CourseDetails",
                    },
                };
            });
            TmcPanel.postMessage(...messages);
        },
    );

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

/**
 * Helper function that downloads exercises and creates the appropriate changes in the UI.
 */
export async function uiDownloadExercises(
    ui: UI,
    actionContext: ActionContext,
    mode: string,
    courseId: number,
    exerciseIds: number[],
): Promise<void> {
    if (mode === "update") {
        ui.webview.postMessage({
            command: "setUpdateables",
            exerciseIds: [],
            courseId: courseId,
        });
        const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds);
        if (downloadResult.ok) {
            ui.webview.postMessage({
                command: "setUpdateables",
                exerciseIds: downloadResult.val.failed,
                courseId: courseId,
            });
        }
        return;
    }

    ui.webview.postMessage({
        command: "setNewExercises",
        courseId: courseId,
        exerciseIds: [],
    });

    const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds);
    if (downloadResult.err) {
        actionContext.dialog.errorNotification(
            "Failed to download new exercises.",
            downloadResult.val,
        );
        return;
    }

    const refreshResult = Result.all(
        await actionContext.userData.clearFromNewExercises(courseId, downloadResult.val.successful),
        await refreshLocalExercises(actionContext),
    );
    if (refreshResult.err) {
        actionContext.dialog.errorNotification(
            "Failed to refresh local exercises.",
            refreshResult.val,
        );
    }

    ui.webview.postMessage({
        command: "setNewExercises",
        courseId: courseId,
        exerciseIds: actionContext.userData.getCourse(courseId).newExercises,
    });
    const exerciseStatusChangeMessages = exerciseIds.map((id) => {
        const message: ExtensionToWebview = {
            type: "exerciseStatusChange",
            target: {
                type: "CourseDetails",
            },
            exerciseId: id,
            status: "closed",
        };
        return message;
    });
    TmcPanel.postMessage(...exerciseStatusChangeMessages);
}
