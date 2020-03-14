import * as vscode from "vscode";
import Resources from "../config/resources";
import TemplateEngine from "./templateEngine";

/**
 * A class for managing the Webview component of the plugin UI, to be used through the UI class
 */
export default class TmcWebview {
    public readonly templateEngine: TemplateEngine;

    private readonly extensionContext: vscode.ExtensionContext;
    private readonly messageHandlers: Map<string, (msg: any) => void> = new Map();

    /**
     * NOTE: use [[getPanel]] to correctly handle disposed instances
     */
    private panel: vscode.WebviewPanel | undefined;

    private readonly resources: Resources;

    /**
     * Creates a TmcWebview object used by the UI class
     * @param extensionContext The VSCode extension context, required for path resolution for the CSS stylesheet
     */
    constructor(extensionContext: vscode.ExtensionContext, resources: Resources) {
        this.extensionContext = extensionContext;
        this.templateEngine = new TemplateEngine(resources);
        this.resources = resources;
    }

    /**
     * Sets the HTML content of the webview and brings it to the front
     * Deprecated, use [[setContentFromTemplate]] instead
     *
     * @param html A string containing a full HTML document
     */
    public setContent(html: string): void {
        const panel = this.getPanel();
        panel.webview.html = html;
        panel.reveal();
    }

    /**
     * Sets the HTML content of the webview from a template and brings it to the front
     * @param templateName A string containing the name of one of the templates
     * @param data Any data to be passed to the template
     */
    public async setContentFromTemplate(
        templateName: string,
        data?: any,
        forceUpdate = false,
    ): Promise<void> {
        const panel = this.getPanel();
        const html = await this.templateEngine.getTemplate(panel.webview, templateName, data);
        if (forceUpdate) {
            panel.webview.html = html + " ";
        }
        panel.webview.html = html;
        panel.reveal();
    }

    /**
     * Register a handler for a specific message type sent from the webview
     * @param messageId The message type to handle
     * @param handler A handler function that receives the full message as a parameter
     */
    public registerHandler(messageId: string, handler: (msg: any) => void): void {
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
                { enableScripts: true },
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
            this.panel.iconPath = vscode.Uri.file(`${this.resources.mediaFolder}/TMC.svg`);
        }
        return this.panel;
    }
}
