import {
    addNewCourse,
    closeExercises,
    login,
    openExercises,
    openWorkspace,
    pasteExercise,
    removeCourse,
    testInterrupts,
    updateCourse,
} from "../actions";
import { ActionContext } from "../actions/types";
import { ExerciseStatus } from "../api/workspaceManager";
import * as commands from "../commands";
import { TMC_BACKEND_URL } from "../config/constants";
import { uiDownloadExercises } from "../init";
import { ExtensionToWebview, Panel, WebviewToExtension } from "../shared/shared";
import * as UITypes from "../ui/types";
import {
    cliFolder,
    dateToString,
    formatSizeInBytes,
    Logger,
    parseDate,
    parseNextDeadlineAfter,
} from "../utilities";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { postMessageToWebview, renderPanel } from "../utilities/panel";
import getFolderSize from "get-folder-size";
import { compact } from "lodash";
import { Result } from "ts-results";
import { Disposable, Uri, ViewColumn, Webview, WebviewPanel, window } from "vscode";
import * as vscode from "vscode";

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

    // last panel rendered into this webview; resent on "ready" so a reloaded webview can recover
    private _lastPanel: Panel | undefined;

    // last targeted (non-broadcast) message per (target id, message type) posted since _lastPanel
    // was set, keyed as `${id}:${type}`; resent after setPanel on "ready" so a reload doesn't lose
    // one-shot results (testResults, submissionResult, ...) that already fired before the reload
    private _messageBuffer: Map<string, ExtensionToWebview> = new Map();

    private _disposables: Disposable[] = [];

    // sends a message to the main and side panels
    public static async postMessage(...messages: Array<ExtensionToWebview>): Promise<void> {
        for (const message of messages) {
            TmcPanel.mainPanel?._postMessage(message, "Main webview");
            TmcPanel.sidePanel?._postMessage(message, "Side webview");
        }
    }

    private _postMessage(message: ExtensionToWebview, context: string): void {
        if ("id" in message.target) {
            this._messageBuffer.set(`${message.target.id}:${message.type}`, message);
        }
        postMessageToWebview(this._panel.webview, message, context);
    }

    // renders the `panel` in the main panel
    public static async renderMain(
        extensionUri: Uri,
        extensionContext: vscode.ExtensionContext,
        actionContext: ActionContext,
        panel: Panel,
    ): Promise<void> {
        if (TmcPanel.mainPanel !== undefined) {
            TmcPanel.mainPanel._panel.dispose();
        }
        const currentPanel = await TmcPanel.renderNew(
            extensionUri,
            extensionContext,
            actionContext,
            panel,
            true,
        );
        TmcPanel.mainPanel = currentPanel;
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
            Logger.info(`Revealing existing side panel for "${panel.type}"`);
            await TmcPanel.sidePanel._renderPanel(panel);
            TmcPanel.sidePanel._panel.reveal(column, false);
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
            // without this, a hidden-then-revealed panel reloads the webview from scratch,
            // dropping any fire-and-forget message posted before the reveal
            retainContextWhenHidden: true,
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
        await currentPanel._renderPanel(panel);
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
        Logger.info(`Created ${isMain ? "main" : "side"} panel`);
    }

    // disposes the side panel when disposing the main panel as well
    public dispose(): void {
        Logger.info(`Disposing ${this._isMain ? "main" : "side"} panel`);
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

    // renders `panel` into this webview and remembers it, so it can be resent on "ready"
    private async _renderPanel(panel: Panel): Promise<void> {
        this._lastPanel = panel;
        this._messageBuffer.clear();
        await renderPanel(panel, this._panel.webview);
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
                />
                <meta property="csp-nonce" content="${nonce}" />
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
                    case "ready": {
                        // webview (re)mounted; resend whatever panel it should be showing
                        Logger.info(
                            `Received "ready" from ${this._isMain ? "main" : "side"} webview` +
                                (this._lastPanel
                                    ? `, resending panel "${this._lastPanel.type}"`
                                    : ", no panel to resend"),
                        );
                        if (this._lastPanel) {
                            // resend via renderPanel directly, not this._renderPanel(), which
                            // would clear the buffer we're about to resend
                            await renderPanel(this._lastPanel, webview);
                            const context = this._isMain ? "Main webview" : "Side webview";
                            for (const buffered of this._messageBuffer.values()) {
                                postMessageToWebview(webview, buffered, context);
                            }
                        }
                        break;
                    }
                    case "requestCourseDetailsData": {
                        const { tmc, userData, workspaceManager } = actionContext;
                        if (!(tmc.ok && userData.ok && workspaceManager.ok)) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        const course = userData.val.getCourse(message.sourcePanel.courseId);
                        postMessageToWebview(webview, {
                            type: "setCourseData",
                            target: message.sourcePanel,
                            courseData: course,
                        });

                        tmc.val.getCourseDetails(message.sourcePanel.courseId).then((apiCourse) => {
                            const offlineMode = apiCourse.err; // failed to get course details = offline mode
                            const exerciseData = new Map<
                                string,
                                UITypes.CourseDetailsExerciseGroup
                            >();

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
                            postMessageToWebview(webview, {
                                type: "setCourseDisabledStatus",
                                target: message.sourcePanel,
                                courseId: course.id,
                                disabled: course.disabled,
                            });
                            course.exercises.forEach((ex) => {
                                const nameMatch = ex.name.match(/(\w+)-(.+)/);
                                const groupName = nameMatch?.[1] || "";
                                const group = exerciseData.get(groupName);
                                const name = nameMatch?.[2] || "";
                                const exData = workspaceManager.val.getExerciseBySlug(
                                    course.name,
                                    ex.name,
                                );
                                const softDeadline = ex.softDeadline
                                    ? parseDate(ex.softDeadline)
                                    : null;
                                const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null;
                                postMessageToWebview(webview, {
                                    type: "exerciseStatusChange",
                                    target: message.sourcePanel,
                                    exerciseId: ex.id,
                                    status: mapStatus(
                                        exData?.status ?? ExerciseStatus.Missing,
                                        hardDeadline !== null && currentDate >= hardDeadline,
                                    ),
                                });
                                const entry: UITypes.CourseDetailsExercise = {
                                    id: ex.id,
                                    name,
                                    passed:
                                        course.exercises.find((ce) => ce.id === ex.id)?.passed ||
                                        false,
                                    softDeadline,
                                    softDeadlineString: softDeadline
                                        ? dateToString(softDeadline)
                                        : "-",
                                    hardDeadline,
                                    hardDeadlineString: hardDeadline
                                        ? dateToString(hardDeadline)
                                        : "-",
                                    isHard:
                                        softDeadline && hardDeadline
                                            ? hardDeadline <= softDeadline
                                            : true,
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
                                        exercises: e.exercises.sort((a, b) =>
                                            a.name > b.name ? 1 : -1,
                                        ),
                                        nextDeadlineString: offlineMode
                                            ? "Next deadline: Not available"
                                            : parseNextDeadlineAfter(
                                                  currentDate,
                                                  e.exercises.map((ex) => ({
                                                      date: ex.isHard
                                                          ? ex.hardDeadline
                                                          : ex.softDeadline,
                                                      active: !ex.passed,
                                                  })),
                                              ),
                                    };
                                });
                            postMessageToWebview(webview, {
                                type: "setCourseGroups",
                                target: message.sourcePanel,
                                offlineMode,
                                exerciseGroups,
                            });
                        });
                        break;
                    }
                    case "requestExerciseSubmissionData": {
                        break;
                    }
                    case "requestExerciseTestsData": {
                        break;
                    }
                    case "requestLoginData": {
                        break;
                    }
                    case "requestMyCoursesData": {
                        const { userData, workspaceManager, resources } = actionContext;
                        if (
                            !(
                                userData.ok &&
                                workspaceManager.ok &&
                                resources.ok &&
                                resources.val.projectsDirectory
                            )
                        ) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        postMessageToWebview(webview, {
                            type: "setMyCourses",
                            target: message.sourcePanel,
                            courses: userData.val.getCourses(),
                        });
                        postMessageToWebview(webview, {
                            type: "setTmcDataPath",
                            target: message.sourcePanel,
                            tmcDataPath: resources.val.projectsDirectory,
                        });
                        getFolderSize.loose(resources.val.projectsDirectory).then((size) =>
                            postMessageToWebview(webview, {
                                type: "setTmcDataSize",
                                target: message.sourcePanel,
                                tmcDataSize: formatSizeInBytes(size),
                            }),
                        );
                        break;
                    }
                    case "requestSelectCourseData": {
                        const { tmc } = actionContext;
                        if (!tmc.ok) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        postMessageToWebview(webview, {
                            type: "setTmcBackendUrl",
                            target: message.sourcePanel,
                            tmcBackendUrl: TMC_BACKEND_URL,
                        });

                        const organizations = await tmc.val.getOrganizations();
                        if (organizations.err) {
                            actionContext.dialog.errorNotification(
                                "Failed to open panel.",
                                organizations.val,
                            );
                            return;
                        }
                        const organization = organizations.val.find(
                            (o) => o.slug === message.sourcePanel.organizationSlug,
                        );
                        if (organization === undefined) {
                            actionContext.dialog.errorNotification(
                                `Failed to open panel: could not find organization "${message.sourcePanel.organizationSlug}"`,
                            );
                            return;
                        }
                        postMessageToWebview(webview, {
                            type: "setOrganization",
                            target: message.sourcePanel,
                            organization,
                        });

                        const courses = await tmc.val.getCourses(organization.slug);
                        if (courses.err) {
                            actionContext.dialog.errorNotification(
                                "Failed to open panel.",
                                courses.val,
                            );
                            return;
                        }
                        postMessageToWebview(webview, {
                            type: "setSelectableCourses",
                            target: message.sourcePanel,
                            courses: courses.val,
                        });
                        break;
                    }
                    case "requestSelectOrganizationData": {
                        const { tmc } = actionContext;
                        if (!tmc.ok) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        postMessageToWebview(webview, {
                            type: "setTmcBackendUrl",
                            target: message.sourcePanel,
                            tmcBackendUrl: TMC_BACKEND_URL,
                        });

                        const organizations = await tmc.val.getOrganizations();
                        if (organizations.err) {
                            actionContext.dialog.errorNotification(
                                "Failed to open panel.",
                                organizations.val,
                            );
                            return;
                        }
                        postMessageToWebview(webview, {
                            type: "setOrganizations",
                            target: message.sourcePanel,
                            organizations: organizations.val,
                        });
                        break;
                    }
                    case "requestWelcomeData": {
                        const { resources } = actionContext;
                        if (!resources.ok) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        const version = resources.val.extensionVersion;
                        postMessageToWebview(webview, {
                            type: "setWelcomeData",
                            target: message.sourcePanel,
                            version,
                        });
                        break;
                    }
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
                            await this._renderPanel({
                                id: randomPanelId(),
                                type: "MyCourses",
                                courseDeadlines: {},
                            });
                        }
                        break;
                    }
                    case "openCourseDetails": {
                        await this._renderPanel({
                            id: randomPanelId(),
                            type: "CourseDetails",
                            courseId: message.courseId,
                        });
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
                        const { userData } = actionContext;
                        if (!userData.ok) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        const course = userData.val.getCourse(message.id);
                        if (
                            await actionContext.dialog.explicitConfirmation(
                                `Do you want to remove ${course.name} from your courses? \
                                This won't delete your downloaded exercises.`,
                            )
                        ) {
                            await removeCourse(actionContext, message.id);
                            await this._renderPanel({
                                id: randomPanelId(),
                                type: "MyCourses",
                                courseDeadlines: {},
                            });
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
                        await this._renderPanel({
                            id: randomPanelId(),
                            type: "MyCourses",
                            courseDeadlines: {},
                        });
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
                        const { userData } = actionContext;
                        if (!userData.ok) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        userData.val.clearFromNewExercises(message.courseId);
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
                        const { tmc, userData } = actionContext;
                        if (!(tmc.ok && userData.ok)) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        // todo: move to actions
                        // download exercises that don't exist locally
                        const course = userData.val.getCourseByName(message.courseName);
                        const courseExercises = new Map(course.exercises.map((x) => [x.id, x]));
                        const exercisesToOpen = compact(
                            message.ids.map((x) => courseExercises.get(x)),
                        );
                        const localCourseExercises = await tmc.val.listLocalCourseExercises(
                            message.courseName,
                        );
                        if (localCourseExercises.err) {
                            actionContext.dialog.errorNotification(
                                "Error trying to list local exercises while opening selected exercises.",
                                localCourseExercises.val,
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
                            extensionContext,
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
                        const updateResult = await updateCourse(actionContext, courseId);
                        if (updateResult.err) {
                            actionContext.dialog.errorNotification(
                                "Failed to update course.",
                                updateResult.val,
                            );
                        }
                        await this._renderPanel({
                            id: randomPanelId(),
                            type: "CourseDetails",
                            courseId: courseId,
                        });
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
                        const { userData } = actionContext;
                        if (!userData.ok) {
                            Logger.error("Extension was not initialized properly");
                            return;
                        }

                        const result = await addNewCourse(
                            actionContext,
                            message.organizationSlug,
                            message.courseId,
                        );
                        if (result.err) {
                            actionContext.dialog.errorNotification(
                                "Failed to add new course.",
                                result.val,
                            );
                        }
                        postMessageToWebview(webview, {
                            type: "setMyCourses",
                            target: message.requestingPanel,
                            courses: userData.val.getCourses(),
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
                        const interrupts = testInterrupts.get(message.testRunId);
                        if (interrupts) {
                            for (const interrupt of interrupts) {
                                interrupt();
                                testInterrupts.delete(message.testRunId);
                            }
                        }
                        break;
                    }
                    case "submitExercise": {
                        // actions.submitExercise (called from commands.submitExercise) owns
                        // rendering the ExerciseSubmission panel itself, gated on its single-flight
                        // guard - rendering it here first would blow past that guard and orphan
                        // the panel on a duplicate click
                        try {
                            const result = await commands.submitExercise(
                                extensionContext,
                                actionContext,
                                message.exerciseUri,
                            );
                            if (result.err) {
                                TmcPanel.postMessage({
                                    type: "submitFailed",
                                    target: { type: "ExerciseTests" },
                                });
                            }
                        } catch (error) {
                            Logger.error("Unexpected error during exercise submission", error);
                            TmcPanel.postMessage({
                                type: "submitFailed",
                                target: { type: "ExerciseTests" },
                            });
                        }
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
                                "Failed to send to TMC Paste.",
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
                    case "requestInitializationErrors": {
                        const {
                            exerciseDecorationProvider,
                            resources,
                            tmc,
                            userData,
                            workspaceManager,
                        } = actionContext;

                        TmcPanel.postMessage({
                            type: "initializationErrors",
                            target: message.sourcePanel,
                            cliFolder: cliFolder(extensionContext),
                            initializationErrors: {
                                tmc: formatError(tmc),
                                userData: formatError(userData),
                                workspaceManager: formatError(workspaceManager),
                                resources: formatError(resources),
                                exerciseDecorationProvider: formatError(exerciseDecorationProvider),
                            },
                        });
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

function formatError(res: Result<unknown, Error>): { error: string; stack: string } | null {
    if (res.err) {
        if (res.val.cause) {
            const error = `${res.val.message}: ${res.val.cause}`;
            const stack = res.val.stack ?? "no stack trace";
            return { error, stack };
        } else {
            const error = res.val.message;
            const stack = res.val.stack ?? "no stack trace";
            return { error, stack };
        }
    } else {
        return null;
    }
}
