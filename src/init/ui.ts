import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { downloadOrUpdateExercises, refreshLocalExercises } from "../actions";
import { ActionContext } from "../actions/types";
import { TmcPanel } from "../panels/TmcPanel";
import {
    assertUnreachable,
    CourseIdentifier,
    ExerciseIdentifier,
    ExtensionToWebview,
    LocalCourseData,
} from "../shared/shared";
import UI from "../ui/ui";
import { Logger } from "../utilities/";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(actionContext: ActionContext): Result<void, Error> {
    const {
        ui,
        visibilityGroups,
        userData,
        langs,
        resources,
        exerciseDecorationProvider,
        workspaceManager,
    } = actionContext;
    Logger.info("Initializing UI Actions");

    if (userData.err) {
        return new Err(new Error("Extension was not initialized properly"));
    }

    // Register UI actions
    ui.treeDP.registerAction("Log in", "logIn", [visibilityGroups.loggedIn.not], {
        command: "tmc.showLogin",
        title: "",
        arguments: [],
    });

    const courses = userData.val.getCourses();
    ui.treeDP.registerAction(
        "My Courses",
        "myCourses",
        [visibilityGroups.loggedIn],
        {
            command: "tmc.myCourses",
            title: "Go to My Courses",
        },
        courses.length !== 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
        courses.map<{ label: string; id: string; command: vscode.Command }>((course) => {
            switch (course.kind) {
                case "tmc": {
                    const tmcCourse = course.data;
                    return {
                        label: tmcCourse.title,
                        id: tmcCourse.id.toString(),
                        command: {
                            command: "tmc.courseDetails",
                            title: "Go to course details",
                            arguments: [tmcCourse.id],
                        },
                    };
                }
                case "mooc": {
                    const moocCourse = course.data;
                    return {
                        label: moocCourse.courseName,
                        id: moocCourse.instanceId,
                        command: {
                            command: "tmc.courseDetails",
                            title: "Go to course details",
                            arguments: [moocCourse.instanceId],
                        },
                    };
                }
                default: {
                    assertUnreachable(course);
                }
            }
        }),
    );
    if (
        !(
            userData.ok &&
            langs.ok &&
            resources.ok &&
            exerciseDecorationProvider.ok &&
            workspaceManager.ok
        )
    ) {
        // something failed
        ui.treeDP.registerAction(
            "View initialization error help",
            "tmc.viewInitializationErrorHelp",
            [],
            {
                command: "tmc.viewInitializationErrorHelp",
                title: "Open help message for the extension initialization error",
            },
        );
        ui.treeDP.registerAction(
            "Restart extension host",
            "workbench.action.restartExtensionHost",
            [],
            { command: "workbench.action.restartExtensionHost", title: "Restart extension host" },
        );
    }

    // Register UI actions
    if (langs.ok) {
        // cannot login without tmc
        ui.treeDP.registerAction("Log in", "logIn", [visibilityGroups.loggedIn.not], {
            command: "tmc.showLogin",
            title: "",
            arguments: [],
        });
    }

    if (userData.ok) {
        const userCourses = userData.val.getCourses();
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
                label: LocalCourseData.getCourseName(course),
                id: CourseIdentifier.toString(LocalCourseData.getCourseId(course)),
                command: {
                    command: "tmc.courseDetails",
                    title: "Go to course details",
                    arguments: [LocalCourseData.getCourseId(course)],
                },
            })),
        );
    }

    ui.treeDP.registerAction("Settings", "settings", [], {
        command: "tmc.settings",
        title: "Go to TMC Settings",
    });
    ui.treeDP.registerAction("Open TMC Exercises Folder", "tmcDataFolder", [], {
        command: "tmc.openTMCExercisesFolder",
        title: "Open TMC Exercises Folder",
    });
    ui.treeDP.registerAction("Open TMC Extension Logs", "logs", [], {
        command: "tmc.logs",
        title: "Open TMC Extension Logs",
    });
    ui.treeDP.registerAction("Log out", "logOut", [visibilityGroups.loggedIn], {
        command: "tmc.logout",
        title: "Log out",
    });

    return Ok.EMPTY;
}

/**
 * Helper function that downloads exercises and creates the appropriate changes in the UI.
 */
export async function uiDownloadExercises(
    ui: UI,
    actionContext: ActionContext,
    mode: string,
    courseId: CourseIdentifier,
    exerciseIds: Array<ExerciseIdentifier>,
): Promise<void> {
    const { userData } = actionContext;
    if (userData.err) {
        Logger.error("Extension was not initialized properly");
        return;
    }

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
        await userData.val.clearFromNewExercises(courseId, downloadResult.val.successful),
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
        exerciseIds: LocalCourseData.getNewExercises(userData.val.getCourse(courseId)),
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
