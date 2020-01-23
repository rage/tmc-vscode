import * as path from "path";
import * as vscode from "vscode";
import {TmcWebview} from "./webview";

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
