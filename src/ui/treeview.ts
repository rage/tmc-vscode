import * as vscode from "vscode";

/**
 * A class for managing the TMC menu treeview.
 */
export default class TmcMenuTree {

    private readonly treeDP: TmcMenuTreeDataProvider;

    /**
     * Creates and registers a new instance of TMCMenuTree with given viewId.
     * @param viewId Id of the view passed to `vscode.window.registerTreeDataProvider`
     */
    constructor(viewId: string) {
        this.treeDP = new TmcMenuTreeDataProvider();
        vscode.window.registerTreeDataProvider(viewId, this.treeDP);
    }

    /**
     * Register an action to be shown in the action treeview.
     * @param label An unique label, displayed in the treeview
     * @param onClick An action handler
     * @param visible Determines whether the action should be visible in the treeview
     */
    public registerAction(label: string, id: string, onClick: () => void, visible: boolean) {
        // Use internal class
        this.treeDP.registerAction(label, id, onClick, visible);
    }

    /**
     * Modifies the visibility of a treeview action, refreshing the treeview if needed.
     * @param label The label of the action to modify
     * @param visible Whether the action should be visible or not
     */
    public setVisibility(id: string, visible: boolean) {
        // use internal class
        this.treeDP.setVisibility(id, visible);
    }

}

/**
 * A class required by VSCode to fulfill the role of a data provider for the action treeview
 */
class TmcMenuTreeDataProvider implements vscode.TreeDataProvider<TMCAction> {

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
     * Internal logic for TmcMenuTree.registerAction
     */
    public registerAction(label: string, id: string, onClick: () => void, visible: boolean) {
        if (this.actions.get(label) !== undefined) {
            return;
        }
        this.actions.set(id, {
            action: new TMCAction(label,
                { command: "tmcView.activateEntry", title: "", arguments: [onClick] }), visible,
        });
        this.refresh();
    }

    /**
     * Internal logic for TmcMenuTree.registerAction
     */
    public setVisibility(id: string, visible: boolean) {
        const action = this.actions.get(id);

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
