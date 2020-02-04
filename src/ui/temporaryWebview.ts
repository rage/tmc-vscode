import * as vscode from "vscode";

import Resources from "../config/resources";
import UI from "./ui";

export default class TemporaryWebview {

    public disposed: boolean;

    private panel: vscode.WebviewPanel;
    private ui: UI;

    constructor(resources: Resources, ui: UI, title: string, messageHandler: (msg: any) => void) {
        this.panel = vscode.window.createWebviewPanel("tmctemp", title, vscode.ViewColumn.Two,
                        { enableScripts: true });
        this.panel.onDidDispose(() => { this.disposed = true; });
        this.panel.webview.onDidReceiveMessage(messageHandler);
        this.panel.iconPath = vscode.Uri.file(`${resources.mediaFolder}/TMC.svg`);
        this.disposed = false;
        this.ui = ui;
        this.panel.reveal(undefined, true);
    }

    public async setContent(templateName: string, data?: any) {
        this.panel.webview.html = await this.ui.templateEngine.getTemplate(this.panel.webview, templateName, data);
        this.panel.reveal(undefined, true);
    }

    public getWebview() {
        return this.panel.webview;
    }
}
