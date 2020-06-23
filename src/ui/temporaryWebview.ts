import * as vscode from "vscode";

import Resources from "../config/resources";
import UI from "./ui";
import { EMPTY_HTML_DOCUMENT } from "../config/constants";
import { TemplateData } from "./types";

interface MessageHandler {
    (msg: { [key: string]: unknown }): void;
}

interface TemporaryWebviewContent {
    template: TemplateData;
    title: string;
    messageHandler: MessageHandler;
}

/**
 * A class for temporary webviews
 */
export default class TemporaryWebview {
    public disposed: boolean;

    private panel: vscode.WebviewPanel;
    private ui: UI;
    private iconPath: vscode.Uri;
    private cssPath: string;
    private handlerDisposer?: vscode.Disposable;

    constructor(resources: Resources, ui: UI) {
        this.ui = ui;
        this.cssPath = resources.cssFolder;
        this.iconPath = vscode.Uri.file(`${resources.mediaFolder}/TMC.svg`);
        this.panel = this.createPanel();
        this.disposed = false;
    }

    /**
     * Sets the content of the webview using an HTML template
     * @param templateData Data to be displayed in template
     */
    public async setContent(content: TemporaryWebviewContent): Promise<void> {
        this.handlerDisposer?.dispose();
        if (this.disposed) {
            this.panel = this.createPanel();
            this.disposed = false;
        }
        this.panel.title = content.title;
        this.panel.webview.html = await this.ui.webview.templateEngine.getTemplate(
            this.panel.webview,
            content.template,
        );
        this.handlerDisposer = this.panel.webview.onDidReceiveMessage(content.messageHandler);
        this.panel.reveal(undefined, true);
    }

    public isVisible(): boolean {
        return this.panel.visible;
    }

    public postMessage(message: unknown): void {
        this.panel?.webview.postMessage(message);
    }

    /**
     * Closes the webview
     */
    public dispose(): void {
        this.panel.dispose();
    }

    private createPanel(): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel("tmctemp", "TMC", vscode.ViewColumn.Two, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(this.cssPath)],
        });
        panel.onDidDispose(() => {
            this.handlerDisposer?.dispose();
            this.handlerDisposer = undefined;
            this.disposed = true;
        });
        panel.iconPath = this.iconPath;
        panel.webview.html = EMPTY_HTML_DOCUMENT;
        return panel;
    }
}
