import * as vscode from "vscode";

import { EMPTY_HTML_DOCUMENT } from "../config/constants";
import Resources from "../config/resources";

import { TemplateData } from "./types";
import UI from "./ui";

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

    private _panel: vscode.WebviewPanel;
    private _ui: UI;
    private _iconPath: vscode.Uri;
    private _cssPath: string;
    private _handlerDisposers: vscode.Disposable[];

    constructor(resources: Resources, ui: UI) {
        this._ui = ui;
        this._cssPath = resources.cssFolder;
        this._iconPath = vscode.Uri.file(`${resources.mediaFolder}/TMC.svg`);
        this._panel = this._createPanel();
        this._handlerDisposers = [];
        this.disposed = false;
    }

    /**
     * Sets the content of the webview using an HTML template
     * @param templateData Data to be displayed in template
     */
    public async setContent(content: TemporaryWebviewContent): Promise<void> {
        this._handlerDisposers?.forEach((h) => h.dispose());
        this._handlerDisposers = [];
        if (this.disposed) {
            this._panel = this._createPanel();
            this.disposed = false;
        }
        this._panel.title = content.title;
        this._panel.webview.html = await this._ui.webview.templateEngine.getTemplate(
            this._panel.webview,
            content.template,
        );
        this._handlerDisposers = this._handlerDisposers.concat(
            this._panel.webview.onDidReceiveMessage(content.messageHandler),
        );
        this._panel.reveal(undefined, true);
    }

    public isVisible(): boolean {
        return this._panel.visible;
    }

    public postMessage(message: unknown): void {
        this._panel?.webview.postMessage(message);
    }

    /**
     * Closes the webview
     */
    public dispose(): void {
        this._panel.dispose();
    }

    private _createPanel(): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel("tmctemp", "TMC", vscode.ViewColumn.Two, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(this._cssPath)],
        });
        panel.onDidDispose(() => {
            this._handlerDisposers?.forEach((h) => h.dispose());
            this._handlerDisposers = [];
            this.disposed = true;
        });
        panel.iconPath = this._iconPath;
        panel.webview.html = EMPTY_HTML_DOCUMENT;
        return panel;
    }
}
