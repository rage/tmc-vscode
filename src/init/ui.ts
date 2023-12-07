import { Result } from "ts-results";
import * as vscode from "vscode";

import { downloadOrUpdateExercises, refreshLocalExercises } from "../actions";
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
    const { ui, visibilityGroups } = actionContext;
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
        TmcPanel.postMessage({
            type: "setUpdateables",
            target: { type: "CourseDetails" },
            exerciseIds: [],
        });
        const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds);
        if (downloadResult.ok) {
            TmcPanel.postMessage({
                type: "setUpdateables",
                target: { type: "CourseDetails" },
                exerciseIds: downloadResult.val.failed,
            });
        }
        return;
    }

    TmcPanel.postMessage({
        type: "setNewExercises",
        target: {
            type: "MyCourses",
        },
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

    TmcPanel.postMessage({
        type: "setNewExercises",
        target: { type: "MyCourses" },
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
