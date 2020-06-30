import * as path from "path";
import * as vscode from "vscode";
import Resources from "../config/resources";
import TemplateEngine from "./templateEngine";
import { EMPTY_HTML_DOCUMENT } from "../config/constants";
import { TemplateData, WebviewMessage } from "./types";

/**
 * A class for managing the Webview component of the plugin UI, to be used through the UI class
 */
export default class TmcWebview {
    public readonly templateEngine: TemplateEngine;

    private readonly extensionContext: vscode.ExtensionContext;
    private readonly messageHandlers: Map<string, (msg: { [key: string]: unknown }) => void>;
    private readonly webviewState: Map<string, unknown>;
    private listenerDisposer?: vscode.Disposable;

    /**
     * NOTE: use [[getPanel]] to correctly handle disposed instances
     */
    private panel: vscode.WebviewPanel | undefined;

    private readonly resources: Resources;

    private stateId = 0;

    /**
     * Creates a TmcWebview object used by the UI class
     * @param extensionContext The VSCode extension context, required for path resolution for the CSS stylesheet
     */
    constructor(extensionContext: vscode.ExtensionContext, resources: Resources) {
        this.extensionContext = extensionContext;
        this.messageHandlers = new Map();
        this.webviewState = new Map();
        this.templateEngine = new TemplateEngine(resources);
        this.resources = resources;
    }

    /**
     * Sets the HTML content of the webview from a template and brings it to the front
     * @param templateName A string containing the name of one of the templates
     * @param data Any data to be passed to the template
     */
    public async setContentFromTemplate(
        templateData: TemplateData,
        forceUpdate = false,
        initialState?: Array<{ key: string; message: WebviewMessage }>,
    ): Promise<void> {
        this.stateId++;
        const panel = this.getPanel();
        const html = await this.templateEngine.getTemplate(panel.webview, templateData);
        if (forceUpdate) {
            panel.webview.html = html + " ";
        }
        panel.webview.html = html;
        this.listenerDisposer?.dispose();
        this.webviewState.clear();
        this.listenerDisposer = panel.onDidChangeViewState((event) => {
            if (event.webviewPanel.visible) {
                panel.webview.postMessage(Array.from(this.webviewState.values()));
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
    public postMessage(...messages: Array<{ key: string; message: WebviewMessage }>): void {
        for (const { key, message } of messages) {
            this.webviewState.set(key, message);
        }
        this.panel?.webview.postMessage(messages.map((m) => m.message));
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
        if (this.messageHandlers.get(messageId) !== undefined) {
            return;
        }
        this.messageHandlers.set(messageId, handler);
    }

    /**
     * Closes the Webview.
     */
    public dispose(): void {
        this.panel?.dispose();
    }

    /**
     * Re-creates the webview panel if it has been disposed and returns it
     * @return A webview panel with strong freshness guarantees
     */
    private getPanel(): vscode.WebviewPanel {
        if (this.panel === undefined) {
            this.panel = vscode.window.createWebviewPanel(
                "tmcmenu",
                "TestMyCode",
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.file(this.resources.cssFolder)],
                },
            );
            this.panel.onDidDispose(
                () => {
                    this.panel = undefined;
                },
                this,
                this.extensionContext.subscriptions,
            );
            this.panel.webview.onDidReceiveMessage(
                (msg: { type: string; [x: string]: string }) => {
                    const handler = this.messageHandlers.get(msg.type);
                    if (handler) {
                        handler(msg);
                    } else {
                        console.error("Unhandled message type: " + msg.type);
                    }
                },
                this,
                this.extensionContext.subscriptions,
            );
            this.panel.iconPath = vscode.Uri.file(path.join(this.resources.mediaFolder, "TMC.svg"));
            this.panel.webview.html = EMPTY_HTML_DOCUMENT;
        }
        return this.panel;
    }

    public getStateId(): number {
        return this.stateId;
    }
}
