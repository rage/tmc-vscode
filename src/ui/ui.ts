import * as vscode from "vscode";

export default class UI {

    public treeDP: TmcTDP;

    constructor() {
        this.treeDP = new TmcTDP();
        const tree = vscode.window.createTreeView("tmcView", {treeDataProvider: this.treeDP});
        this.treeDP.registerAction("login", () => {
            this.treeDP.setVisibility("login", false);
            this.treeDP.setVisibility("logout", true);
        }, true);
        this.treeDP.registerAction("logout", () => {
            this.treeDP.setVisibility("logout", false);
            this.treeDP.setVisibility("login", true);
        }, false);
    }

    public createUiActionHandler() {
        return (onClick: () => void) => {
            onClick();
        };
    }
}

class TmcTDP implements vscode.TreeDataProvider<TMCAction> {

    // TreeView items are stored in this map
    public actions: Map<string, {action: TMCAction, visible: boolean}> = new Map();

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
        this.actions.set(label, {action: new TMCAction(label,
             {command: "tmcView.activateEntry", title: "", arguments: [onClick]}), visible});
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
