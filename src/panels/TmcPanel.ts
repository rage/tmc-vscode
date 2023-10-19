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
    updateCourse,
} from "../actions";
import { ActionContext } from "../actions/types";
import { uiDownloadExercises } from "../init";
import { WebviewToExtension, ExtensionToWebview, Panel } from "../shared";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { postMessageToWebview, renderPanel } from "../utilities/panel";

/**
 * Manages the rendering of the extension webview panels.
 */
export class TmcPanel {
    // primary panel that most data is displayed in
    public static mainPanel: TmcPanel | undefined;

    // extra panel for situations where we want to render another view beside the main one
    public static sidePanel: TmcPanel | undefined;

    private readonly _panel: WebviewPanel;

    // if true, this is the main panel, otherwise this is the side panel
    private readonly _isMain: boolean;

    private _disposables: Disposable[] = [];

    // renders the `panel` in the main panel
    public static async renderMain(
        extensionUri: Uri,
        actionContext: ActionContext,
        panel: Panel,
    ): Promise<void> {
        const column = ViewColumn.One;
        if (TmcPanel.mainPanel !== undefined) {
            await renderPanel(
                panel,
                extensionUri,
                actionContext,
                TmcPanel.mainPanel._panel.webview,
            );
            TmcPanel.mainPanel._panel.reveal(column);
        } else {
            const currentPanel = await TmcPanel.renderNew(extensionUri, actionContext, panel, true);
            TmcPanel.mainPanel = currentPanel;
        }
    }

    // renders the `panel` in the side panel
    static async renderSide(
        extensionUri: Uri,
        actionContext: ActionContext,
        panel: Panel,
    ): Promise<void> {
        const column = ViewColumn.Two;
        if (TmcPanel.sidePanel !== undefined) {
            await renderPanel(
                panel,
                extensionUri,
                actionContext,
                TmcPanel.sidePanel._panel.webview,
            );
            TmcPanel.sidePanel._panel.reveal(column);
        } else {
            const currentPanel = await TmcPanel.renderNew(
                extensionUri,
                actionContext,
                panel,
                false,
            );
            TmcPanel.sidePanel = currentPanel;
        }
    }

    // convenience function for rendering a main/side panel when no main/side panel exists yet
    // otherwise the panel can simply be "revealed" with `panel.reveal`
    static async renderNew(
        extensionUri: Uri,
        actionContext: ActionContext,
        panel: Panel,
        isMain: boolean,
    ): Promise<TmcPanel> {
        let panelViewType;
        let column;
        if (isMain) {
            panelViewType = "mainPanel";
            column = ViewColumn.One;
        } else {
            panelViewType = "sidePanel";
            column = ViewColumn.Two;
        }
        const webviewPanel = window.createWebviewPanel(panelViewType, "TestMyCode", column, {
            enableScripts: true,
            localResourceRoots: [
                Uri.joinPath(extensionUri, "out"),
                Uri.joinPath(extensionUri, "webview-ui/public/build"),
                Uri.joinPath(extensionUri, "media"),
                Uri.joinPath(extensionUri, "resources"),
            ],
        });
        const currentPanel = new TmcPanel(webviewPanel, extensionUri, actionContext, isMain);
        await renderPanel(panel, extensionUri, actionContext, currentPanel._panel.webview);
        return currentPanel;
    }

    private constructor(
        panel: WebviewPanel,
        extensionUri: Uri,
        actionContext: ActionContext,
        isMain: boolean,
    ) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

        this._setWebviewMessageListener(this._panel.webview, extensionUri, actionContext);

        this._isMain = isMain;
    }

    // disposes the side panel when disposing the main panel as well
    public dispose(): void {
        this._panel.dispose();

        if (this._isMain) {
            TmcPanel.mainPanel = undefined;
            // if we're disposing the main panel, we'll dispose the side panel as well
            TmcPanel.sidePanel?.dispose();
        }
        TmcPanel.sidePanel = undefined;

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

    // receives messages from the webview
    private _setWebviewMessageListener(
        webview: Webview,
        extensionUri: Uri,
        actionContext: ActionContext,
    ): void {
        webview.onDidReceiveMessage(
            async (message: WebviewToExtension) => {
                switch (message.type) {
                    case "login": {
                        const result = await login(
                            actionContext,
                            message.username,
                            message.password,
                        );
                        if (result.err) {
                            postMessageToWebview(
                                webview,
                                {
                                    id: message.sourcePanel.id,
                                    type: "Login",
                                },
                                {
                                    type: "loginError",
                                    error: result.val.message,
                                },
                            );
                        } else {
                            await renderPanel(
                                {
                                    id: randomPanelId(),
                                    type: "MyCourses",
                                },
                                extensionUri,
                                actionContext,
                                webview,
                            );
                        }
                        break;
                    }
                    case "openCourseDetails": {
                        await renderPanel(
                            {
                                id: randomPanelId(),
                                type: "CourseDetails",
                                courseId: message.courseId,
                            },
                            extensionUri,
                            actionContext,
                            webview,
                        );
                        break;
                    }
                    case "selectOrganization": {
                        await TmcPanel.renderSide(extensionUri, actionContext, {
                            id: randomPanelId(),
                            type: "SelectOrganization",
                            requestingPanel: message.sourcePanel,
                        });
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
                            await renderPanel(
                                {
                                    id: randomPanelId(),
                                    type: "MyCourses",
                                },
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
                        await renderPanel(
                            {
                                id: randomPanelId(),
                                type: "MyCourses",
                            },
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
                    case "selectCourse": {
                        await TmcPanel.renderSide(extensionUri, actionContext, {
                            id: randomPanelId(),
                            type: "SelectCourse",
                            organizationSlug: message.slug,
                            requestingPanel: message.sourcePanel,
                        });
                        break;
                    }
                    case "addCourse": {
                        const result = await addNewCourse(
                            actionContext,
                            message.organizationSlug,
                            message.courseId,
                        );
                        if (result.err) {
                            actionContext.dialog.errorNotification(
                                `Failed to add new course: ${result.val.message}`,
                            );
                        }
                        break;
                    }
                    case "relayToWebview": {
                        if (this._isMain) {
                            // relay msg from main panel to side panel
                            if (TmcPanel.sidePanel) {
                                TmcPanel.sidePanel._panel.webview.postMessage(message.message);
                            }
                        } else {
                            // relay msg from side panel to main panel
                            if (TmcPanel.mainPanel)
                                TmcPanel.mainPanel._panel.webview.postMessage(message.message);
                        }
                    }
                    case "closeSidePanel": {
                        if (TmcPanel.sidePanel) {
                            TmcPanel.sidePanel.dispose();
                        }
                    }
                    case "ready": {
                        // no-op
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

// helper to make an exhaustive switch statement
function assertUnreachable(x: never): never {
    throw new Error(`unreachable ${x}`);
}

// helper to generate a random ids when creating panels
export function randomPanelId(): number {
    return Math.floor(Math.random() * 100_000_000);
}
