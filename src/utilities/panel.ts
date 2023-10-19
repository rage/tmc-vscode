import du = require("du");
import { Uri, Webview } from "vscode";

import { ActionContext } from "../actions/types";
import { ExerciseStatus } from "../api/workspaceManager";
import {
    CourseDetailsPanel,
    WebviewToExtension,
    ExtensionToWebview,
    MyCoursesPanel,
    Panel,
    PanelType,
    SelectOrganizationPanel,
    SpecificPanel,
    TargetedExtensionToWebview,
    WelcomePanel,
    assertUnreachable,
    SelectCoursePanel,
} from "../shared";
import * as UITypes from "../ui/types";

import { dateToString, parseDate, parseNextDeadlineAfter } from "./dateDeadline";
import { getUri } from "./getUri";
import { formatSizeInBytes } from "./utils";
import { Logger } from "./logger";
import { TMC_BACKEND_URL } from "../config/constants";

/**
 * Helper function for the extension panel to render a webview panel.
 */
export async function renderPanel(
    panel: Panel,
    extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
): Promise<void> {
    // this future is used in `postMessage` calls to wait for the rendered panel
    // to be ready to receive messages
    const waitForPanelToRender: Promise<boolean> = new Promise((resolve) => {
        webview.onDidReceiveMessage((message: WebviewToExtension) => {
            // by checking the panel id, we make sure we don't read a stale "ready" message
            if (message.type === "ready" && message.panel.id === panel.id) {
                // false to indicate "did not time out"
                resolve(false);
            }
        });
    });

    // we render the panel immediately
    postMessageToWebview(
        webview,
        { id: 0, type: "App" },
        {
            type: "setPanel",
            panel,
        },
    );

    // and then send other needed data (after receiving "ready")
    switch (panel.type) {
        case "Welcome": {
            initializeWelcome(panel, extensionUri, actionContext, webview, waitForPanelToRender);
            break;
        }
        case "Login": {
            // no messages to send
            break;
        }
        case "MyCourses": {
            initializeMyCourses(panel, extensionUri, actionContext, webview, waitForPanelToRender);
            break;
        }
        case "CourseDetails": {
            initializeCourseDetails(
                panel,
                extensionUri,
                actionContext,
                webview,
                waitForPanelToRender,
            );
            break;
        }
        case "SelectOrganization": {
            initializeSelectOrganization(
                panel,
                extensionUri,
                actionContext,
                webview,
                waitForPanelToRender,
            );
            break;
        }
        case "SelectCourse": {
            initializeSelectCourse(
                panel,
                extensionUri,
                actionContext,
                webview,
                waitForPanelToRender,
            );
            break;
        }
        case "App": {
            break;
        }
        default: {
            assertUnreachable(panel);
        }
    }
}

// note: this function should not be awaited
export async function postMessageToWebview<T extends PanelType>(
    webview: Webview,
    targetPanel: SpecificPanel<T>,
    message: TargetedExtensionToWebview<T>,
    // this callback is awaited before sending the message
    waitForPanelToRender?: Promise<boolean>,
): Promise<void> {
    Logger.info("Message to webview", message);
    if (waitForPanelToRender !== undefined) {
        const fiveSeconds = 5000;
        const timeout: Promise<boolean> = new Promise((resolve) => {
            setTimeout(() => {
                resolve(true);
            }, fiveSeconds);
        });
        const timedOut = await Promise.race([waitForPanelToRender, timeout]);
        if (timedOut) {
            Logger.error("Timed out trying to send message", message);
            return;
        }
    }
    // TS does not recognise this as a valid "MessageToWebview" without the override
    const messageToWebview: ExtensionToWebview = {
        source: "extensionHost",
        panelId: targetPanel.id,
        panelType: targetPanel.type,
        message,
    } as ExtensionToWebview;
    webview.postMessage(messageToWebview);
}

async function initializeWelcome(
    panel: WelcomePanel,
    extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
    waitForPanelToRender: Promise<boolean>,
) {
    const version = actionContext.resources.extensionVersion;
    const exerciseDecorations = getUri(webview, extensionUri, [
        "media",
        "welcome_exercise_decorations.png",
    ]).toString();
    Logger.info("initwelcome;");
    postMessageToWebview(
        webview,
        panel,
        {
            type: "setWelcomeData",
            version,
            exerciseDecorations,
        },
        waitForPanelToRender,
    );
}

async function initializeMyCourses(
    panel: MyCoursesPanel,
    extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
    waitForPanelToRender: Promise<boolean>,
) {
    postMessageToWebview(
        webview,
        panel,
        {
            type: "setCourses",
            courses: actionContext.userData.getCourses(),
        },
        waitForPanelToRender,
    );
    postMessageToWebview(
        webview,
        panel,
        {
            type: "setTmcDataPath",
            tmcDataPath: actionContext.resources.projectsDirectory,
        },
        waitForPanelToRender,
    );
    du(actionContext.resources.projectsDirectory).then((size) =>
        postMessageToWebview(
            webview,
            panel,
            {
                type: "setTmcDataSize",
                tmcDataSize: formatSizeInBytes(size),
            },
            waitForPanelToRender,
        ),
    );
}

async function initializeCourseDetails(
    panel: CourseDetailsPanel,
    _extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
    waitForPanelToRender: Promise<boolean>,
) {
    const { tmc, userData, workspaceManager } = actionContext;

    const course = userData.getCourse(panel.courseId);
    postMessageToWebview(
        webview,
        panel,
        {
            type: "setCourseData",
            courseData: course,
        },
        waitForPanelToRender,
    );

    tmc.getCourseDetails(panel.courseId).then((apiCourse) => {
        const offlineMode = apiCourse.err; // failed to get course details = offline mode
        const exerciseData = new Map<string, UITypes.CourseDetailsExerciseGroup>();

        const mapStatus = (status: ExerciseStatus, expired: boolean): UITypes.ExerciseStatus => {
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
        postMessageToWebview(
            webview,
            panel,
            {
                type: "setCourseDisabledStatus",
                courseId: course.id,
                disabled: course.disabled,
            },
            waitForPanelToRender,
        );
        course.exercises.forEach((ex) => {
            const nameMatch = ex.name.match(/(\w+)-(.+)/);
            const groupName = nameMatch?.[1] || "";
            const group = exerciseData.get(groupName);
            const name = nameMatch?.[2] || "";
            const exData = workspaceManager.getExerciseBySlug(course.name, ex.name);
            const softDeadline = ex.softDeadline ? parseDate(ex.softDeadline) : null;
            const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null;
            postMessageToWebview(
                webview,
                panel,
                {
                    type: "exerciseStatusChange",
                    exerciseId: ex.id,
                    status: mapStatus(
                        exData?.status ?? ExerciseStatus.Missing,
                        hardDeadline !== null && currentDate >= hardDeadline,
                    ),
                },
                waitForPanelToRender,
            );
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
        postMessageToWebview(
            webview,
            panel,
            {
                type: "setCourseGroups",
                offlineMode,
                exerciseGroups,
            },
            waitForPanelToRender,
        );
    });
}

async function initializeSelectOrganization(
    panel: SelectOrganizationPanel,
    _extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
    waitForPanelToRender: Promise<boolean>,
) {
    postMessageToWebview(
        webview,
        panel,
        { type: "setTmcBackendUrl", tmcBackendUrl: TMC_BACKEND_URL },
        waitForPanelToRender,
    );

    const organizations = await actionContext.tmc.getOrganizations();
    if (organizations.err) {
        actionContext.dialog.errorNotification(`Failed to open panel: ${organizations.err}`);
        return;
    }
    postMessageToWebview(
        webview,
        panel,
        { type: "setOrganizations", organizations: organizations.val },
        waitForPanelToRender,
    );
}

async function initializeSelectCourse(
    panel: SelectCoursePanel,
    _extensionUri: Uri,
    actionContext: ActionContext,
    webview: Webview,
    waitForPanelToRender: Promise<boolean>,
) {
    postMessageToWebview(
        webview,
        panel,
        { type: "setTmcBackendUrl", tmcBackendUrl: TMC_BACKEND_URL },
        waitForPanelToRender,
    );

    const organizations = await actionContext.tmc.getOrganizations();
    if (organizations.err) {
        actionContext.dialog.errorNotification(`Failed to open panel: ${organizations.err}`);
        return;
    }
    const organization = organizations.val.find((o) => o.slug === panel.organizationSlug);
    if (organization === undefined) {
        actionContext.dialog.errorNotification(
            `Failed to open panel: could not find organization "${panel.organizationSlug}"`,
        );
        return;
    }
    postMessageToWebview(
        webview,
        panel,
        { type: "setOrganization", organization },
        waitForPanelToRender,
    );

    const courses = await actionContext.tmc.getCourses(organization.slug);
    if (courses.err) {
        actionContext.dialog.errorNotification(`Failed to open panel: ${courses.err}`);
        return;
    }
    postMessageToWebview(
        webview,
        panel,
        { type: "setCourses", courses: courses.val },
        waitForPanelToRender,
    );
}
