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
    pasteExercise,
    removeCourse,
    updateCourse,
} from "../actions";
import { ActionContext } from "../actions/types";
import * as commands from "../commands";
import { uiDownloadExercises } from "../init";
import { ExtensionToWebview, Panel, WebviewToExtension } from "../shared/shared";
import { Logger } from "../utilities";
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

    // sends a message to the main and side panels
    public static async postMessage(...messages: Array<ExtensionToWebview>): Promise<void> {
        Logger.info("Posting message(s) to webview", JSON.stringify(messages, null, 2));
        const mainWebview = TmcPanel.mainPanel?._panel.webview;
        const sideWebview = TmcPanel.sidePanel?._panel.webview;
        for (const message of messages) {
            if (mainWebview) {
                mainWebview.postMessage(message);
            }
            if (sideWebview) {
                sideWebview.postMessage(message);
            }
        }
    }

    // renders the `panel` in the main panel
    public static async renderMain(
        extensionUri: Uri,
        extensionContext: vscode.ExtensionContext,
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
            const currentPanel = await TmcPanel.renderNew(
                extensionUri,
                extensionContext,
                actionContext,
                panel,
                true,
            );
            TmcPanel.mainPanel = currentPanel;
        }
    }

    // renders the `panel` in the side panel
    static async renderSide(
        extensionUri: Uri,
        extensionContext: vscode.ExtensionContext,
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
                extensionContext,
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
        extensionContext: vscode.ExtensionContext,
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
        const currentPanel = new TmcPanel(
            webviewPanel,
            extensionContext,
            extensionUri,
            actionContext,
            isMain,
        );
        await renderPanel(panel, extensionUri, actionContext, currentPanel._panel.webview);
        return currentPanel;
    }

    private constructor(
        panel: WebviewPanel,
        extensionContext: vscode.ExtensionContext,
        extensionUri: Uri,
        actionContext: ActionContext,
        isMain: boolean,
    ) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

        this._setWebviewMessageListener(
            this._panel.webview,
            extensionContext,
            extensionUri,
            actionContext,
        );

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
        const stylesUri = getUri(webview, extensionUri, [
            "webview-ui",
            "public",
            "build",
            "bundle.css",
        ]);
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
                        img-src ${webview.cspSource} https:;;
                        style-src 'nonce-${nonce}';
                        script-src 'nonce-${nonce}';"
                >
                <link nonce="${nonce}" rel="stylesheet" type="text/css" href="${stylesUri}" />
                <script defer nonce="${nonce}" src="${scriptUri}" />
            </head>
                <body>
                </body>
            </html>

            <style>
                body {
                    /* ensures no layout shift during loading */
                    scrollbar-gutter: stable;
                }
            </style>
      `;
    }

    // receives messages from the webview
    private _setWebviewMessageListener(
        webview: Webview,
        extensionContext: vscode.ExtensionContext,
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
                            postMessageToWebview(webview, {
                                type: "loginError",
                                target: message.sourcePanel,
                                error: result.val.message,
                            });
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
                        await TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
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
                    case "closeExercises": {
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
                    case "openExercises": {
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
                        const exerciseStatusChangeMessages: Array<ExtensionToWebview> =
                            message.ids.map((id) => {
                                const message: ExtensionToWebview = {
                                    type: "exerciseStatusChange",
                                    exerciseId: id,
                                    status: "opened",
                                    target: {
                                        type: "CourseDetails",
                                    },
                                };
                                return message;
                            });
                        TmcPanel.postMessage(...exerciseStatusChangeMessages);
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
                                await renderPanel(
                                    {
                                        id: randomPanelId(),
                                        type: "CourseDetails",
                                        courseId: courseId,
                                    },
                                    extensionUri,
                                    actionContext,
                                    webview,
                                );
                            }
                        }
                        break;
                    }
                    case "selectCourse": {
                        await TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
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
                        postMessageToWebview(webview, {
                            type: "setMyCourses",
                            target: message.requestingPanel,
                            courses: actionContext.userData.getCourses(),
                        });
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
                            if (TmcPanel.mainPanel) {
                                TmcPanel.mainPanel._panel.webview.postMessage(message.message);
                            }
                        }
                        break;
                    }
                    case "closeSidePanel": {
                        if (TmcPanel.sidePanel) {
                            TmcPanel.sidePanel.dispose();
                        }
                        break;
                    }
                    case "cancelTests": {
                        break;
                    }
                    case "submitExercise": {
                        await TmcPanel.renderSide(extensionUri, extensionContext, actionContext, {
                            id: randomPanelId(),
                            type: "ExerciseSubmission",
                            course: message.course,
                            exercise: message.exercise,
                        });
                        commands.submitExercise(
                            extensionContext,
                            actionContext,
                            message.exerciseUri,
                        );

                        break;
                    }
                    case "pasteExercise": {
                        const pasteResult = await pasteExercise(
                            actionContext,
                            message.course.name,
                            message.exercise.name,
                        );
                        if (pasteResult.err) {
                            actionContext.dialog.errorNotification(
                                `Failed to send to TMC Paste: ${pasteResult.val.message}.`,
                                pasteResult.val,
                            );
                            TmcPanel.postMessage({
                                type: "pasteError",
                                target: message.requestingPanel,
                                error: pasteResult.val.message,
                            });
                        } else {
                            const value = pasteResult.val || "Link not provided by server.";
                            TmcPanel.postMessage({
                                type: "pasteResult",
                                target: message.requestingPanel,
                                pasteLink: value,
                            });
                        }
                        break;
                    }
                    case "openLinkInBrowser": {
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                        break;
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
