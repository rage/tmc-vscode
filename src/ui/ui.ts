import * as path from "path";
import * as vscode from "vscode";

/**
 * A class for interacting with the user through graphical means
 */
export default class UI {

    /**
     * A TmcTDP object for interacting with the treeview panel
     */
    public treeDP: TmcTDP = new TmcTDP();
    /**
     * A Webview object for interacting with the main Webview
     */
    public webview: TmcWebview;

    /**
     * Creates an UI object and (temporarily) initializes it with login-related content
     * @param extensionContext VSCode extension content
     */
    constructor(extensionContext: vscode.ExtensionContext) {
        this.webview = new TmcWebview(extensionContext);
        this.initialize();
    }

    /**
     * @return A handler callback for the tmcView.activateEntry command
     */
    public createUiActionHandler(): (onClick: () => void) => void {
        return (onClick: () => void) => {
            onClick();
        };
    }

    /**
     * Registers a tree data provider for VSCode to use to populate the tmc actions treeview
     */
    public initialize() {

        vscode.window.registerTreeDataProvider("tmcView", this.treeDP);

    }
}

/**
 * A class for handling the Webview component of the plugin UI, to be used through the UI class
 */
class TmcWebview {

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
     * Wraps an HTML fragment, representing the body of the document, with a template containing a CSS stylesheet
     * @param body The HTML fragment, i.e. everything that goes between the body tags
     */
    public htmlWrap(body: string): string {
        return `<html><head><link rel="stylesheet" type="text/css" href="${this.resolvePath("resources/style.css")}"></head><body>${body}</body></html>`;
    }

    /**
     * Creates an absolute path to a file in the extension folder, for use within the webview
     * @param relativePath The relative path to the file within the extension folder, e.g. 'resources/style.css'
     */
    public resolvePath(relativePath: string): string {
        return vscode.Uri.file(path.join(this.extensionContext.extensionPath, relativePath)).toString().replace("file:", "vscode-resource:");
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

/**
 * A class required by VSCode to fulfill the role of a data provider for the action treeview
 */
class TmcTDP implements vscode.TreeDataProvider<TMCAction> {

    /**
     * Required by VSCode to enable refreshing of the treeview freely along with [[onDidChangeTreeData]]
     */
    public refreshEventEmitter: vscode.EventEmitter<TMCAction | undefined> =
        new vscode.EventEmitter<TMCAction | undefined>();
    /**
     * Required by VSCode to enable refreshing of the treeview freely along with [[refreshEventEmitter]]
     */
    public readonly onDidChangeTreeData: vscode.Event<TMCAction | undefined> = this.refreshEventEmitter.event;

    private actions: Map<string, { action: TMCAction, visible: boolean }> = new Map();

    /**
     * Used by VSCode to populate the treeview
     */
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

    /**
     * Used by VSCode, currently the identity function
     */
    public getTreeItem(element: TMCAction) {
        return element;
    }

    /**
     * Register an action to be shown in the action treeview
     * @param label An unique label, displayed in the treeview
     * @param onClick An action handler
     * @param visible Determines whether the action should be visible in the treeview
     */
    public registerAction(label: string, onClick: () => void, visible: boolean) {
        if (this.actions.get(label) !== undefined) {
            return;
        }
        this.actions.set(label, {
            action: new TMCAction(label,
                { command: "tmcView.activateEntry", title: "", arguments: [onClick] }), visible,
        });
        this.refresh();
    }

    /**
     * Modifies the visibility of a treeview action, refreshing the treeview if needed
     * @param label The label of the action to modify
     * @param visible Whether the action should be visible or not
     */
    public setVisibility(label: string, visible: boolean) {
        const action = this.actions.get(label);

        if (action) {
            if (action.visible !== visible) {
                action.visible = visible;
                this.refresh();
            }
        }
    }

    /**
     * Triggers a treeview refresh
     */
    private refresh(): void {
        this.refreshEventEmitter.fire();
    }

}

/**
 * Data class representing an item in the action treeview
 */
class TMCAction extends vscode.TreeItem {

    constructor(label: string, command?: vscode.Command) {
        super(label);
        this.command = command;
    }

}
