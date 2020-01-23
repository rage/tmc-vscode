import * as vscode from "vscode";

/**
 * A class required by VSCode to fulfill the role of a data provider for the action treeview
 */
export default class TmcTDP implements vscode.TreeDataProvider<TMCAction> {

    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
     */
    public readonly onDidChangeTreeData: vscode.Event<TMCAction | undefined>;

    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
     */
    private refreshEventEmitter: vscode.EventEmitter<TMCAction | undefined>;

    private actions: Map<string, { action: TMCAction, visible: boolean }>;

    /**
     * Creates new instance of TMC treeview.
     */
    public constructor() {
        this.refreshEventEmitter = new vscode.EventEmitter<TMCAction | undefined>();
        this.onDidChangeTreeData = this.refreshEventEmitter.event;
        this.actions = new Map<string, { action: TMCAction, visible: boolean }>();
    }

    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
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
     * @implements {vscode.TreeDataProvider<TMCAction>}
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
