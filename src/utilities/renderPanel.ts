import du = require("du");
import { Uri, Webview } from "vscode";

import { ActionContext } from "../actions/types";
import { ExerciseStatus } from "../api/workspaceManager";
import { MessageToWebview, Panel } from "../shared";
import * as UITypes from "../ui/types";

import { dateToString, parseDate, parseNextDeadlineAfter } from "./dateDeadline";
import { getUri } from "./getUri";
import { formatSizeInBytes } from "./utils";

/**
 * Helper function for the extension panel to render a webview panel.
 */
export async function renderPanel(
    panel: Panel,
    extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
): Promise<void> {
    // we render the panel immediately
    post(webview, {
        type: "setPanel",
        panel,
    });
    // and then send other needed data
    switch (panel.type) {
        case "Welcome": {
            const version = actionContext.resources.extensionVersion;
            const exerciseDecorations = getUri(webview, extensionUri, [
                "media",
                "welcome_exercise_decorations.png",
            ]).toString();
            const dataMessage: MessageToWebview = {
                type: "setWelcomeData",
                version,
                exerciseDecorations,
            };
            webview.postMessage(dataMessage);
            break;
        }
        case "Login": {
            break;
        }
        case "MyCourses": {
            post(webview, { type: "setCourses", courses: actionContext.userData.getCourses() });
            post(webview, {
                type: "setTmcDataPath",
                tmcDataPath: actionContext.resources.projectsDirectory,
            });
            du(actionContext.resources.projectsDirectory).then((size) =>
                post(webview, {
                    type: "setTmcDataSize",
                    tmcDataSize: formatSizeInBytes(size),
                }),
            );

            break;
        }
        case "CourseDetails": {
            const { tmc, userData, workspaceManager } = actionContext;

            const course = userData.getCourse(panel.courseId);
            post(webview, { type: "setCourseData", courseData: course });

            tmc.getCourseDetails(panel.courseId).then((apiCourse) => {
                const offlineMode = apiCourse.err; // failed to get course details = offline mode
                const exerciseData = new Map<string, UITypes.CourseDetailsExerciseGroup>();

                const mapStatus = (
                    status: ExerciseStatus,
                    expired: boolean,
                ): UITypes.ExerciseStatus => {
                    switch (status) {
                        case ExerciseStatus.Closed:
                            return "closed";
                        case ExerciseStatus.Open:
                            return "opened";
                        default:
                            return expired ? "expired" : "new";
                    }
                };
                const currentDate = new Date();
                post(webview, {
                    type: "setCourseDisabledStatus",
                    courseId: course.id,
                    disabled: course.disabled,
                });
                course.exercises.forEach((ex) => {
                    const nameMatch = ex.name.match(/(\w+)-(.+)/);
                    const groupName = nameMatch?.[1] || "";
                    const group = exerciseData.get(groupName);
                    const name = nameMatch?.[2] || "";
                    const exData = workspaceManager.getExerciseBySlug(course.name, ex.name);
                    const softDeadline = ex.softDeadline ? parseDate(ex.softDeadline) : null;
                    const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null;
                    post(webview, {
                        type: "exerciseStatusChange",
                        exerciseId: ex.id,
                        status: mapStatus(
                            exData?.status ?? ExerciseStatus.Missing,
                            hardDeadline !== null && currentDate >= hardDeadline,
                        ),
                    });
                    const entry: UITypes.CourseDetailsExercise = {
                        id: ex.id,
                        name,
                        passed: course.exercises.find((ce) => ce.id === ex.id)?.passed || false,
                        softDeadline,
                        softDeadlineString: softDeadline ? dateToString(softDeadline) : "-",
                        hardDeadline,
                        hardDeadlineString: hardDeadline ? dateToString(hardDeadline) : "-",
                        isHard: softDeadline && hardDeadline ? hardDeadline <= softDeadline : true,
                    };

                    exerciseData.set(groupName, {
                        name: groupName,
                        nextDeadlineString: "",
                        exercises: group?.exercises.concat(entry) || [entry],
                    });
                });
                const exerciseGroups = Array.from(exerciseData.values())
                    .sort((a, b) => (a.name > b.name ? 1 : -1))
                    .map((e) => {
                        return {
                            ...e,
                            exercises: e.exercises.sort((a, b) => (a.name > b.name ? 1 : -1)),
                            nextDeadlineString: offlineMode
                                ? "Next deadline: Not available"
                                : parseNextDeadlineAfter(
                                      currentDate,
                                      e.exercises.map((ex) => ({
                                          date: ex.isHard ? ex.hardDeadline : ex.softDeadline,
                                          active: !ex.passed,
                                      })),
                                  ),
                        };
                    });
                post(webview, {
                    type: "setCourseGroups",
                    offlineMode,
                    exerciseGroups,
                });
            });
            break;
        }
        case "Initial": {
            break;
        }
        default: {
            assertUnreachable(panel);
        }
    }
}

function post(webview: Webview, message: MessageToWebview): void {
    webview.postMessage(message);
}

function assertUnreachable(x: never): never {
    throw new Error(`Unreachable ${x}`);
}
