import * as vscode from "vscode";
import * as path from "path";

import UI from "../ui/ui";
import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import { UserData } from "../config/userdata";
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
import { CourseExerciseDownloads } from "../actions/types";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(
    ui: UI,
    tmc: TMC,
    workspaceManager: WorkspaceManager,
    resources: Resources,
    userData: UserData,
): void {
    const LOGGED_IN = ui.treeDP.createVisibilityGroup(tmc.isAuthenticated());
    const WORKSPACE_OPEN = ui.treeDP.createVisibilityGroup(isWorkspaceOpen(resources));

    const visibilityGroups = {
        LOGGED_IN,
        WORKSPACE_OPEN,
    };

    // Register UI actions
    const actionContext = { tmc, workspaceManager, ui, resources, userData };

    ui.treeDP.registerAction("Log out", [LOGGED_IN], () => {
        logout(visibilityGroups, actionContext);
    });
    ui.treeDP.registerAction("Log in", [LOGGED_IN.not], () => {
        ui.webview.setContentFromTemplate("login");
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
                ui.webview.setContentFromTemplate("login", { error: result.val.message }, true);
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
            await downloadExercises(actionContext, [downloads], msg.courseId);
            workspaceManager.openExercise(...msg.ids);
        },
    );
    ui.webview.registerHandler("addCourse", async () => {
        const result = await addNewCourse(actionContext);
        if (result.err) {
            vscode.window.showErrorMessage(result.val.message);
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
                vscode.window.showErrorMessage(`Can't display downloads: ${res.val.message}`);
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
            actionContext.ui.webview.setContentFromTemplate("loading");
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
            actionContext.ui.webview.setContentFromTemplate("loading");
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
                console.log(`Moved workspace folder from ${old} to ${newPath}`);
                if (!res.val) {
                    await showNotification(
                        `Some files could not be removed from the previous workspace directory. They will have to be removed manually. ${old}`,
                        ["OK", (): void => {}],
                    );
                }

                resources.setDataPath(newPath);
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
                showError(res.val.message);
            }
            workspaceManager.restartWatcher();
            openSettings(actionContext);
        }
    });
}
