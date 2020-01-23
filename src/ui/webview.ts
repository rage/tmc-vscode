import * as vscode from "vscode";

/**
 * A class for handling the Webview component of the plugin UI, to be used through the UI class
 */
export class TmcWebview {

    private extensionContext: vscode.ExtensionContext;
    private messageHandlers: Map<string, (msg: any) => void> = new Map();

    /**
     * NOTE: use [[getPanel]] to correctly handle disposed instances
     */
    private panel: vscode.WebviewPanel | undefined;

    /**
     * Creates a TmcWebview object used by the UI class
     * @param extensionContext The VSCode extension context, required for path resolution for the CSS stylesheet
     */
    constructor(extensionContext: vscode.ExtensionContext) {
        this.extensionContext = extensionContext;
    }

    /**
     * Sets the HTML content of the webview and brings it to the front
     * @param html A string containing a full HTML document, see [[htmlWrap]]
     */
    public setContent(html: string) {
        const panel = this.getPanel();
        panel.webview.html = html;
        panel.reveal();
    }

    /**
     * Register a handler for a specific message type sent from the webview
     * @param messageId The message type to handle
     * @param handler A handler function that receives the full message as a parameter
     */
    public registerHandler(messageId: string, handler: (msg: any) => void) {
        if (this.messageHandlers.get(messageId) !== undefined) {
            return;
        }
        this.messageHandlers.set(messageId, handler);
    }

    /**
     * Closes the Webview.
     */
    public dispose() {
        this.panel?.dispose();
    }

    /**
     * Re-creates the webview panel if it has been disposed and returns it
     * @return A webview panel with strong freshness guarantees
     */
    private getPanel(): vscode.WebviewPanel {
        if (this.panel === undefined) {
            this.panel = vscode.window.createWebviewPanel("tmcmenu", "TestMyCode", vscode.ViewColumn.Active,
                { enableScripts: true });
            this.panel.onDidDispose(() => { this.panel = undefined; },
                this, this.extensionContext.subscriptions);
            this.panel.webview.onDidReceiveMessage((msg: { type: string, [x: string]: string }) => {
                const handler = this.messageHandlers.get(msg.type);
                if (handler) {
                    handler(msg);
                } else {
                    console.error("Unhandled message type: " + msg.type);
                }
            },
                this, this.extensionContext.subscriptions);
        }
        return this.panel;
    }
}