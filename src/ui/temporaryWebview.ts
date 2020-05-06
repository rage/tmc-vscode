import * as vscode from "vscode";

import Resources from "../config/resources";
import UI from "./ui";
import { EMPTY_HTML_DOCUMENT } from "../config/constants";
import { TemplateData } from "./types";

/**
 * A class for temporary webviews
 */
export default class TemporaryWebview {
    public disposed: boolean;

    private panel: vscode.WebviewPanel;
    private ui: UI;
    private messageHandlers: Array<(msg: { [key: string]: unknown }) => void>;
    private iconPath: vscode.Uri;
    private title: string;
    private cssPath: string;

    constructor(
        resources: Resources,
        ui: UI,
        title: string,
        messageHandler: (msg: { [key: string]: unknown }) => void,
    ) {
        this.ui = ui;
        this.messageHandlers = [messageHandler];
        this.title = title;
        this.cssPath = resources.cssFolder;
        this.iconPath = vscode.Uri.file(`${resources.mediaFolder}/TMC.svg`);
        this.panel = this.createPanel();
        this.disposed = false;
    }

    /**
     * Sets the content of the webview using an HTML template
     * @param templateData Data to be displayed in template
     */
    public async setContent(templateData: TemplateData): Promise<void> {
        if (this.disposed) {
            this.panel = this.createPanel();
            this.disposed = false;
        }
        this.panel.webview.html = await this.ui.webview.templateEngine.getTemplate(
            this.panel.webview,
            templateData,
        );
        this.panel.reveal(undefined, true);
    }

    /**
     * Adds new messagehandler to this temporary webview.
     *
     * Note that previous message handlers will still be in effect.
     *
     * @param messageHandler New messagehandler to add
     */
    public addMessageHandler(messageHandler: (msg: { [key: string]: unknown }) => void): void {
        if (this.disposed) {
            this.panel = this.createPanel();
            this.disposed = false;
        }
        this.messageHandlers = this.messageHandlers.concat(messageHandler);
        this.panel.webview.onDidReceiveMessage(messageHandler);
    }

    public setTitle(title: string): void {
        this.title = title;
        this.panel.title = title;
    }

    /**
     * Closes the webview
     */
    public dispose(): void {
        this.panel.dispose();
    }

    private createPanel(): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel(
            "tmctemp",
            this.title,
            vscode.ViewColumn.Two,
            { enableScripts: true, localResourceRoots: [vscode.Uri.file(this.cssPath)] },
        );
        panel.onDidDispose(() => {
            this.disposed = true;
        });
        this.messageHandlers.forEach((handler) => panel.webview.onDidReceiveMessage(handler));
        panel.iconPath = this.iconPath;
        panel.webview.html = EMPTY_HTML_DOCUMENT;
        return panel;
    }
}
