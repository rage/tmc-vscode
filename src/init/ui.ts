import * as vscode from "vscode";

import UI from "../ui/ui";
import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import { UserData } from "../config/userdata";
import { askForExplicitConfirmation, isWorkspaceOpen } from "../utils/";
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
    openWorkspace,
    removeCourse,
    updateCourse,
} from "../actions";

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
        vscode.commands.executeCommand("workbench.action.openSettings", "TestMyCode");
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
        (msg: {
            type?: "downloadExercises";
            ids?: number[];
            courseName?: string;
            organizationSlug?: string;
            courseId?: number;
        }) => {
            if (!(msg.type && msg.ids && msg.courseName && msg.organizationSlug && msg.courseId)) {
                return;
            }
            downloadExercises(actionContext, msg.ids, msg.organizationSlug, msg.courseId);
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
            const res = await displayCourseDownloads(msg.id, actionContext);
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
                await askForExplicitConfirmation(
                    `Do you want to remove ${course.name} from your courses? This won't delete your downloaded exercises.`,
                )
            ) {
                await removeCourse(msg.id, actionContext);
                await displayUserCourses(actionContext);
                vscode.window.showInformationMessage(`${course.name} was removed from courses.`);
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
}
