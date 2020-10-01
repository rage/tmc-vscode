import * as path from "path";
import * as vscode from "vscode";

import { EMPTY_HTML_DOCUMENT } from "../config/constants";
import Resources from "../config/resources";
import { Logger } from "../utils";

import TemplateEngine from "./templateEngine";
import { TemplateData, WebviewMessage } from "./types";

/**
 * A class for managing the Webview component of the plugin UI, to be used through the UI class
 */
export default class TmcWebview {
    public readonly templateEngine: TemplateEngine;

    private readonly _extensionContext: vscode.ExtensionContext;
    private readonly _messageHandlers: Map<string, (msg: { [key: string]: unknown }) => void>;
    private readonly _webviewState: Map<string, unknown>;
    private readonly _resources: Resources;
    private _listenerDisposer?: vscode.Disposable;

    /**
     * NOTE: use [[getPanel]] to correctly handle disposed instances
     */
    private _panel: vscode.WebviewPanel | undefined;

    private _stateId = 0;

    /**
     * Creates a new TmcWebview instance used by the UI class.
     * @param extensionContext The VSCode extension context, required for path resolution for the
     * CSS stylesheet.
     */
    constructor(extensionContext: vscode.ExtensionContext, resources: Resources) {
        this._extensionContext = extensionContext;
        this._messageHandlers = new Map();
        this._webviewState = new Map();
        this.templateEngine = new TemplateEngine(resources);
        this._resources = resources;
    }

    /**
     * Sets the HTML content of the webview from a template and brings it to the front
     * @param templateName A string containing the name of one of the templates
     * @param data Any data to be passed to the template
     */
    public async setContentFromTemplate(
        templateData: TemplateData,
        forceUpdate = false,
        initialState?: WebviewMessage[],
    ): Promise<void> {
        this._stateId++;
        const panel = this._getPanel();
        const html = await this.templateEngine.getTemplate(panel.webview, templateData);
        if (forceUpdate) {
            panel.webview.html = html + " ";
        }
        panel.webview.html = html;
        this._listenerDisposer?.dispose();
        this._webviewState.clear();
        this._listenerDisposer = panel.onDidChangeViewState((event) => {
            if (event.webviewPanel.visible) {
                panel.webview.postMessage(Array.from(this._webviewState.values()));
            }
        });
        panel.reveal();
        initialState && this.postMessage(...initialState);
    }

    /**
     * Posts a message to the current webview. Keys provided with messages are used to restore
     * latest state when the webview has been hidden.
     *
     * @param messages Pairs of keys and messages to send to webview.
     */
    public postMessage(...messages: WebviewMessage[]): void {
        messages.forEach((message) => this._storeMessageInCache(message));
        this._panel?.webview.postMessage(messages);
    }

    /**
     * Register a handler for a specific message type sent from the webview
     * @param messageId The message type to handle
     * @param handler A handler function that receives the full message as a parameter
     */
    public registerHandler(
        messageId: string,
        handler: (msg: { [key: string]: unknown }) => void,
    ): void {
        if (this._messageHandlers.get(messageId) !== undefined) {
            return;
        }
        this._messageHandlers.set(messageId, handler);
    }

    /**
     * Closes the Webview.
     */
    public dispose(): void {
        this._panel?.dispose();
    }

    public getStateId(): number {
        return this._stateId;
    }

    private _storeMessageInCache(message: WebviewMessage): void {
        const key = ((): string => {
            switch (message.command) {
                case "exerciseStatusChange":
                    return `exercise-${message.exerciseId}-status`;
                case "loginError":
                    return "login-error";
                case "setCourseDisabledStatus":
                    return `course-${message.courseId}-disabled-notification`;
                case "setInsiderStatus":
                    return "insiderStatus";
                case "setNewExercises":
                    return `course-${message.courseId}-new-exercises`;
                case "setNextCourseDeadline":
                    return `course-${message.courseId}-next-deadline`;
                case "setUpdateables":
                    return `course-${message.courseId}-updates`;
                // Default: "return" typescript error if some case is not handled.
            }
        })();

        this._webviewState.set(key, message);
    }

    /**
     * Re-creates the webview panel if it has been disposed and returns it
     * @return A webview panel with strong freshness guarantees
     */
    private _getPanel(): vscode.WebviewPanel {
        if (this._panel === undefined) {
            this._panel = vscode.window.createWebviewPanel(
                "tmcmenu",
                "TestMyCode",
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [
                        vscode.Uri.file(this._resources.cssFolder),
                        vscode.Uri.file(this._resources.mediaFolder),
                    ],
                },
            );
            this._panel.onDidDispose(
                () => {
                    this._panel = undefined;
                },
                this,
                this._extensionContext.subscriptions,
            );
            this._panel.webview.onDidReceiveMessage(
                (msg: { type: string; [x: string]: string }) => {
                    const handler = this._messageHandlers.get(msg.type);
                    if (handler) {
                        handler(msg);
                    } else {
                        Logger.error("Unhandled message type: " + msg.type);
                    }
                },
                this,
                this._extensionContext.subscriptions,
            );
            this._panel.iconPath = vscode.Uri.file(
                path.join(this._resources.mediaFolder, "TMC.svg"),
            );
            this._panel.webview.html = EMPTY_HTML_DOCUMENT;
        }
        return this._panel;
    }
}
