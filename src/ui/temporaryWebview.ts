import * as vscode from "vscode";

import Resources from "../config/resources";
import UI from "./ui";

/**
 * A class for temporary webviews
 */
export default class TemporaryWebview {

    public disposed: boolean;

    private panel: vscode.WebviewPanel;
    private ui: UI;
    private messageHandler: any;
    private iconPath: vscode.Uri;
    private title: string;

    constructor(resources: Resources, ui: UI, title: string, messageHandler: (msg: any) => void) {
        this.ui = ui;
        this.messageHandler = messageHandler;
        this.title = title;
        this.iconPath = vscode.Uri.file(`${resources.mediaFolder}/TMC.svg`);
        this.panel = this.createPanel();
        this.disposed = false;
    }

    /**
     * Sets the content of the webview using an HTML template
     *
     * @param templateName Name of the template to use
     * @param data Data to be passed to the template engine
     * @param recreate Whether the view should be recreated if disposed
     */
    public async setContent(templateName: string, data?: any) {
        if (this.disposed) {
            this.panel = this.createPanel();
            this.disposed = false;
        }
        this.panel.webview.html = await this.ui.webview.templateEngine.getTemplate(
            this.panel.webview, templateName, data);
        this.panel.reveal(undefined, true);
    }

    /**
     * Closes the webview
     */
    public dispose() {
        this.panel.dispose();
    }

    private createPanel() {
        const panel = vscode.window.createWebviewPanel("tmctemp", this.title, vscode.ViewColumn.Two,
                        { enableScripts: true });
        panel.onDidDispose(() => { this.disposed = true; });
        panel.webview.onDidReceiveMessage(this.messageHandler);
        panel.iconPath = this.iconPath;
        return panel;
    }

}
