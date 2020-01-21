import * as path from "path";
import * as vscode from "vscode";

export default class UI {

    public treeDP: TmcTDP = new TmcTDP();
    public webview: TmcWebview;
    private extensionContext: vscode.ExtensionContext;

    constructor(extensionContext: vscode.ExtensionContext) {
        this.extensionContext = extensionContext;
        this.webview = new TmcWebview(extensionContext);
        this.initialize();
    }

    public createUiActionHandler() {
        return (onClick: () => void) => {
            onClick();
        };
    }

    public initialize() {

        vscode.window.registerTreeDataProvider("tmcView", this.treeDP);

        this.treeDP.registerAction("login", () => {
            this.webview.setContent(this.webview.htmlWrap(
                `<h1>Login</h1>
                <form onsubmit="acquireVsCodeApi().postMessage({type: 'login',
                                                                username: document.getElementById('username').value,
                                                                password: document.getElementById('password').value})">
                Email or username:<br>
                <input type="text" id="username"><br>
                Password:<br>
                <input type="password" id="password"><br>
                <input type="submit">
                </form>`));
        }, true);
        this.treeDP.registerAction("logout", () => {
            this.treeDP.setVisibility("logout", false);
            this.treeDP.setVisibility("login", true);
        }, false);

        this.webview.registerHandler("login", (msg: { type: string, username: string, password: string }) => {
            console.log("Logging in as " + msg.username + " with password " + msg.password);
        });
    }
}

class TmcWebview {

    private extensionContext: vscode.ExtensionContext;
    private messageHandlers: Map<string, (msg: any) => void> = new Map();
    private panel: vscode.WebviewPanel | undefined;

    constructor(extensionContext: vscode.ExtensionContext) {
        this.extensionContext = extensionContext;
    }

    public htmlWrap(body: string): string {
        return `<html><head><link rel="stylesheet" type="text/css" href="${this.resolvePath("resources/style.css")}"></head><body>${body}</body></html>`;
    }

    public resolvePath(relativePath: string): string {
        return vscode.Uri.file(path.join(this.extensionContext.extensionPath, relativePath)).toString().replace("file:", "vscode-resource:");
    }

    public setContent(html: string) {
        const panel = this.getPanel();
        panel.webview.html = html;
        panel.reveal();
    }

    public registerHandler(messageId: string, handler: (msg: any) => void) {
        if (this.messageHandlers.get(messageId) !== undefined) {
            return;
        }
        this.messageHandlers.set(messageId, handler);
    }

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

class TmcTDP implements vscode.TreeDataProvider<TMCAction> {

    // TreeView items are stored in this map
    public actions: Map<string, { action: TMCAction, visible: boolean }> = new Map();

    // In order for VSCode to update the tree view list, an onDidChangeTreeData event must fire
    // This emitter makes that possible to achieve (see refresh())
    public refreshEventEmitter: vscode.EventEmitter<TMCAction | undefined> =
        new vscode.EventEmitter<TMCAction | undefined>();
    public readonly onDidChangeTreeData: vscode.Event<TMCAction | undefined> = this.refreshEventEmitter.event;

    // VSCode uses this to populate the TreeView, undefined -> return root items
    public getChildren(element?: TMCAction | undefined): TMCAction[] {
        if (element === undefined) {
            const actionList: TMCAction[] = [];
            for (const action of this.actions) {
                if (action[1].visible) {
                    actionList.push(action[1].action);
                }
            }
            return actionList;
        }
        return [];
    }

    // Mandatory, identity function
    public getTreeItem(element: TMCAction) {
        return element;
    }

    // Adds an item using an unique label to the TreeView, visibility argument determines visibility
    public registerAction(label: string, onClick: () => void, visible: boolean) {
        if (this.actions.get(label) !== undefined) {
            return;
        }
        this.actions.set(label, {
            action: new TMCAction(label,
                { command: "tmcView.activateEntry", title: "", arguments: [onClick] }), visible
        });
        this.refresh();
    }

    // Modifies the visibility of a TreeView item by label, refreshing the TreeView if necessary.
    public setVisibility(label: string, visible: boolean) {
        const action = this.actions.get(label);

        if (action) {
            if (action.visible !== visible) {
                action.visible = visible;
                this.refresh();
            }
        }
    }

    // Emits an event to trigger a TreeView refresh
    private refresh(): void {
        this.refreshEventEmitter.fire();
    }

}

class TMCAction extends vscode.TreeItem {

    constructor(label: string, command?: vscode.Command) {
        super(label);
        this.command = command;
    }

}
