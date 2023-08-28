import { Disposable, Uri, ViewColumn, Webview, WebviewPanel, window } from "vscode";

import { login } from "../actions";
import { ActionContext } from "../actions/types";
import { MessageFromWebview, MessageToWebview, Panel } from "../shared";
import { Logger } from "../utilities";
import { getNonce } from "../utilities/getNonce";
import { getUri } from "../utilities/getUri";
import { makePanel, Without } from "../utilities/makePanel";

export class TmcPanel {
    public static currentPanel: TmcPanel | undefined;
    public static async render(
        extensionUri: Uri,
        actionContext: ActionContext,
        panel: Without<Panel, "data">,
    ): Promise<void> {
        if (TmcPanel.currentPanel) {
            const webviewPanel = await makePanel(
                panel,
                extensionUri,
                actionContext,
                TmcPanel.currentPanel._panel.webview,
            );
            const message: MessageToWebview = {
                type: "setPanel",
                panel: webviewPanel,
            };
            TmcPanel.currentPanel._panel.webview.postMessage(message);
            TmcPanel.currentPanel._panel.reveal(ViewColumn.One);
        } else {
            const webviewPanel = window.createWebviewPanel("showPanel", "Panel", ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [
                    Uri.joinPath(extensionUri, "out"),
                    Uri.joinPath(extensionUri, "webview-ui/public/build"),
                    Uri.joinPath(extensionUri, "media"),
                    Uri.joinPath(extensionUri, "resources"),
                ],
            });
            const currentPanel = new TmcPanel(webviewPanel, extensionUri, actionContext);
            const renderPanel = await makePanel(
                panel,
                extensionUri,
                actionContext,
                currentPanel._panel.webview,
            );
            const message: MessageToWebview = {
                type: "setPanel",
                panel: renderPanel,
            };
            currentPanel._panel.webview.postMessage(message);
            TmcPanel.currentPanel = currentPanel;
        }
    }

    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];

    private constructor(panel: WebviewPanel, extensionUri: Uri, actionContext: ActionContext) {
        this._panel = panel;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

        this._setWebviewMessageListener(this._panel.webview, extensionUri, actionContext);
    }

    public dispose(): void {
        TmcPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _getWebviewContent(webview: Webview, extensionUri: Uri): string {
        const customStylesUri = getUri(webview, extensionUri, ["resources", "styles", "style.css"]);
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
                        img-src ${webview.cspSource};
                        style-src ${webview.cspSource};
                        script-src 'nonce-${nonce}';"
                >
                <link rel="stylesheet" type="text/css" href="${customStylesUri}">
                <link rel="stylesheet" type="text/css" href="${stylesUri}">
                <script defer nonce="${nonce}" src="${scriptUri}"></script>
            </head>
            <body>
            </body>
            </html>
      `;
    }

    private _setWebviewMessageListener(
        webview: Webview,
        extensionUri: Uri,
        actionContext: ActionContext,
    ): void {
        webview.onDidReceiveMessage(
            async (msg) => {
                const message = msg as MessageFromWebview;
                switch (message.type) {
                    case "login": {
                        const result = await login(actionContext, msg.username, msg.password);
                        if (result.err) {
                            const message: MessageToWebview = {
                                type: "loginError",
                                error: result.val.message,
                            };
                            webview.postMessage(message);
                        } else {
                            const panel = await makePanel(
                                { type: "MyCourses" },
                                extensionUri,
                                actionContext,
                                webview,
                            );
                            const setPanel: MessageToWebview = {
                                type: "setPanel",
                                panel,
                            };
                            webview.postMessage(setPanel);
                        }
                        break;
                    }
                    case "openCourseDetails": {
                        const panel = await makePanel(
                            { type: "CourseDetails", args: { id: message.courseId } },
                            extensionUri,
                            actionContext,
                            webview,
                        );
                        const setPanel: MessageToWebview = {
                            type: "setPanel",
                            panel,
                        };
                        webview.postMessage(setPanel);
                        break;
                    }
                    default:
                        Logger.error("Unhandled message type from webview", message.type);
                }
            },
            undefined,
            this._disposables,
        );
    }
}
