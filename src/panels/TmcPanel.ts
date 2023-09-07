import { compact } from "lodash";
import { Disposable, Uri, ViewColumn, Webview, WebviewPanel, window } from "vscode";
import * as vscode from "vscode";

import {
    addNewCourse,
    closeExercises,
    displayLocalCourseDetails,
    login,
    openExercises,
    openWorkspace,
    removeCourse,
    selectOrganizationAndCourse,
    updateCourse,
} from "../actions";
import { ActionContext } from "../actions/types";
import { uiDownloadExercises } from "../init";
import { MessageFromWebview, MessageToWebview, Panel } from "../shared";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { renderPanel } from "../utilities/renderPanel";

export class TmcPanel {
    public static currentPanel: TmcPanel | undefined;
    public static async render(
        extensionUri: Uri,
        actionContext: ActionContext,
        panel: Panel,
    ): Promise<void> {
        if (TmcPanel.currentPanel) {
            await renderPanel(
                panel,
                extensionUri,
                actionContext,
                TmcPanel.currentPanel._panel.webview,
            );
            TmcPanel.currentPanel._panel.reveal(ViewColumn.One);
        } else {
            const webviewPanel = window.createWebviewPanel("showPanel", "Panel", ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [
                    Uri.joinPath(extensionUri, "out"),
                    Uri.joinPath(extensionUri, "webview-ui/public/build"),
                    Uri.joinPath(extensionUri, "media"),
                    Uri.joinPath(extensionUri, "resources"),
                ],
            });
            const currentPanel = new TmcPanel(webviewPanel, extensionUri, actionContext);
            await renderPanel(panel, extensionUri, actionContext, currentPanel._panel.webview);
            TmcPanel.currentPanel = currentPanel;
        }
    }

    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];

    private constructor(panel: WebviewPanel, extensionUri: Uri, actionContext: ActionContext) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

        this._setWebviewMessageListener(this._panel.webview, extensionUri, actionContext);
    }

    public dispose(): void {
        TmcPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getWebviewContent(webview: Webview, extensionUri: Uri): string {
        const stylesUri = getUri(webview, extensionUri, ["resources", "styles", "style.css"]);
        const scriptUri = getUri(webview, extensionUri, [
            "webview-ui",
            "public",
            "build",
            "bundle.js",
        ]);

        const nonce = getNonce();

        return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <title>TestMyCode</title>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta
                    http-equiv="Content-Security-Policy"
                    content="
                        default-src 'none';
                        img-src ${webview.cspSource};
                        style-src ${webview.cspSource};
                        script-src 'nonce-${nonce}';"
                >
                <link rel="stylesheet" type="text/css" href="${stylesUri}">
                <link rel="stylesheet" type="text/css" href="${stylesUri}">
                <script defer nonce="${nonce}" src="${scriptUri}"></script>
            </head>
            <body>
            </body>
            </html>
      `;
    }

    private _setWebviewMessageListener(
        webview: Webview,
        extensionUri: Uri,
        actionContext: ActionContext,
    ): void {
        webview.onDidReceiveMessage(
            async (message: MessageFromWebview) => {
                switch (message.type) {
                    case "login": {
                        const result = await login(
                            actionContext,
                            message.username,
                            message.password,
                        );
                        if (result.err) {
                            const message: MessageToWebview = {
                                type: "loginError",
                                error: result.val.message,
                            };
                            webview.postMessage(message);
                        } else {
                            await await renderPanel(
                                { type: "MyCourses" },
                                extensionUri,
                                actionContext,
                                webview,
                            );
                        }
                        break;
                    }
                    case "openCourseDetails": {
                        await await renderPanel(
                            { type: "CourseDetails", courseId: message.courseId },
                            extensionUri,
                            actionContext,
                            webview,
                        );
                        break;
                    }
                    case "addCourse": {
                        const orgAndCourse = await selectOrganizationAndCourse(actionContext);
                        if (orgAndCourse.err) {
                            return actionContext.dialog.errorNotification(
                                `Failed to add new course: ${orgAndCourse.val.message}`,
                            );
                        }
                        const organization = orgAndCourse.val.organization;
                        const course = orgAndCourse.val.course;
                        const result = await addNewCourse(actionContext, organization, course);
                        if (result.err) {
                            actionContext.dialog.errorNotification(
                                `Failed to add new course: ${result.val.message}`,
                            );
                        } else {
                            await await renderPanel(
                                { type: "MyCourses" },
                                extensionUri,
                                actionContext,
                                webview,
                            );
                        }
                        break;
                    }
                    case "removeCourse": {
                        const course = actionContext.userData.getCourse(message.id);
                        if (
                            await actionContext.dialog.explicitConfirmation(
                                `Do you want to remove ${course.name} from your courses? \
                                This won't delete your downloaded exercises.`,
                            )
                        ) {
                            await removeCourse(actionContext, message.id);
                            await await renderPanel(
                                { type: "MyCourses" },
                                extensionUri,
                                actionContext,
                                webview,
                            );
                            actionContext.dialog.notification(
                                `${course.name} was removed from courses.`,
                            );
                        }
                        break;
                    }
                    case "openCourseWorkspace": {
                        openWorkspace(actionContext, message.courseName);
                        break;
                    }
                    case "changeTmcDataPath": {
                        await vscode.commands.executeCommand("tmc.changeTmcDataPath");
                        break;
                    }
                    case "openMyCourses": {
                        await await renderPanel(
                            { type: "MyCourses" },
                            extensionUri,
                            actionContext,
                            webview,
                        );
                        break;
                    }
                    case "closeSelected": {
                        const result = await closeExercises(
                            actionContext,
                            message.ids,
                            message.courseName,
                        );
                        if (result.err) {
                            actionContext.dialog.errorNotification(
                                "Errored while closing selected exercises.",
                                result.val,
                            );
                        }
                        break;
                    }
                    case "clearNewExercises": {
                        actionContext.userData.clearFromNewExercises(message.courseId);
                        break;
                    }
                    case "downloadExercises": {
                        await uiDownloadExercises(
                            actionContext.ui,
                            actionContext,
                            message.mode,
                            message.courseId,
                            message.ids,
                        );
                        break;
                    }
                    case "openSelected": {
                        // todo: move to actions
                        // download exercises that don't exist locally
                        const course = actionContext.userData.getCourseByName(message.courseName);
                        const courseExercises = new Map(course.exercises.map((x) => [x.id, x]));
                        const exercisesToOpen = compact(
                            message.ids.map((x) => courseExercises.get(x)),
                        );
                        const localCourseExercises =
                            await actionContext.tmc.listLocalCourseExercises(message.courseName);
                        if (localCourseExercises.err) {
                            actionContext.dialog.errorNotification(
                                `Error trying to list local exercises while opening selected exercises. \
                                ${localCourseExercises.val}`,
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
                                actionContext.ui,
                                actionContext,
                                "",
                                course.id,
                                exercisesToDownload.map((etd) => etd.id),
                            );
                        }

                        // now, actually open the exercises
                        const result = await openExercises(
                            actionContext,
                            message.ids,
                            message.courseName,
                        );
                        if (result.err) {
                            actionContext.dialog.errorNotification(
                                "Errored while opening selected exercises.",
                                result.val,
                            );
                        }
                        actionContext.ui.webview.postMessage({
                            command: "setNewExercises",
                            courseId: course.id,
                            exerciseIds: actionContext.userData.getCourse(course.id).newExercises,
                        });
                        break;
                    }
                    case "refreshCourseDetails": {
                        const courseId: number = message.id;
                        const uiState = actionContext.ui.webview.getStateId();

                        if (message.useCache) {
                            displayLocalCourseDetails(actionContext, courseId);
                        } else {
                            const updateResult = await updateCourse(actionContext, courseId);
                            if (updateResult.err) {
                                actionContext.dialog.errorNotification(
                                    `Failed to update course: ${updateResult.val.message}`,
                                    updateResult.val,
                                );
                            }
                            if (uiState === actionContext.ui.webview.getStateId()) {
                                displayLocalCourseDetails(actionContext, courseId);
                            }
                        }
                        break;
                    }
                    default:
                        assertUnreachable(message);
                }
            },
            undefined,
            this._disposables,
        );
    }
}

function assertUnreachable(x: never): never {
    throw new Error(`unreachable ${x}`);
}
