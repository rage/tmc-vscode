import du = require("du");
import { Uri, Webview } from "vscode";

import { ActionContext } from "../actions/types";
import { ExerciseStatus } from "../api/workspaceManager";
import { Panel } from "../shared";
import { CourseDetailsData } from "../ui/types";
import * as UITypes from "../ui/types";

import { dateToString, parseDate, parseNextDeadlineAfter } from "./dateDeadline";
import { getUri } from "./getUri";
import { formatSizeInBytes } from "./utils";

// would use Omit<Panel, "data"> but Omit is not "distributed"
// https://github.com/microsoft/TypeScript/issues/31501
export type Without<Type, Name> = {
    [Property in keyof Type as Exclude<Property, Name>]: Type[Property];
};

/**
 * Helper function for the extension panel to construct a webview panel.
 */
export async function makePanel(
    panel: Without<Panel, "data">,
    extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
): Promise<Panel> {
    switch (panel.type) {
        case "Welcome": {
            const exerciseDecorations = getUri(webview, extensionUri, [
                "media",
                "welcome_exercise_decorations.png",
            ]).toString();
            const version = actionContext.resources.extensionVersion;
            return {
                ...panel,
                data: {
                    version,
                    exerciseDecorations,
                },
            };
        }
        case "Login": {
            return {
                type: panel.type,
            };
        }
        case "MyCourses": {
            const courses = actionContext.userData.getCourses();
            const tmcDataPath = actionContext.resources.projectsDirectory;
            const tmcDataSize = formatSizeInBytes(
                await du(actionContext.resources.projectsDirectory),
            );
            return {
                ...panel,
                data: {
                    courses,
                    tmcDataPath,
                    tmcDataSize,
                },
            };
        }
        case "CourseDetails": {
            const { tmc, userData, workspaceManager } = actionContext;
            const course = userData.getCourse(panel.args.courseId);
            const mapStatus = (
                exerciseId: number,
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
            const exerciseData = new Map<string, UITypes.CourseDetailsExerciseGroup>();
            const apiCourse = (await tmc.getCourseDetails(panel.args.courseId)).mapErr(
                () => undefined,
            ).val;
            const currentDate = new Date();
            const initialState: UITypes.WebviewMessage[] = [
                {
                    command: "setCourseDisabledStatus",
                    courseId: course.id,
                    disabled: course.disabled,
                },
            ];
            course.exercises.forEach((ex) => {
                const nameMatch = ex.name.match(/(\w+)-(.+)/);
                const groupName = nameMatch?.[1] || "";
                const group = exerciseData.get(groupName);
                const name = nameMatch?.[2] || "";
                const exData = workspaceManager.getExerciseBySlug(course.name, ex.name);
                const softDeadline = ex.softDeadline ? parseDate(ex.softDeadline) : null;
                const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null;
                initialState.push({
                    command: "exerciseStatusChange",
                    exerciseId: ex.id,
                    status: mapStatus(
                        ex.id,
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
            const offlineMode = apiCourse === undefined;
            const courseGroups = Array.from(exerciseData.values())
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
            const data: CourseDetailsData = {
                exerciseData: courseGroups,
                course,
                courseId: course.id,
                offlineMode,
            };
            return {
                ...panel,
                data: {
                    data,
                },
            };
        }
        case "Initial": {
            return {
                ...panel,
            };
        }
        default: {
            assertUnreachable(panel);
        }
    }
}

function assertUnreachable(x: never): never {
    throw new Error(`Unreachable ${x}`);
}
