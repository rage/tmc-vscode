import * as vscode from "vscode";
import Visibility from "./visibility";

/**
 * A class for managing the TMC menu treeview.
 */
export default class TmcMenuTree {

    private readonly treeDP: TmcMenuTreeDataProvider;
    private readonly visibility: Visibility;
    private nextId: number;

    /**
     * Creates and registers a new instance of TMCMenuTree with given viewId.
     * @param viewId Id of the view passed to `vscode.window.registerTreeDataProvider`
     */
    constructor(viewId: string) {
        this.treeDP = new TmcMenuTreeDataProvider();
        vscode.window.registerTreeDataProvider(viewId, this.treeDP);

        this.visibility = new Visibility();
        this.nextId = 1;
    }

    /**
     * Register an action to be shown in the action treeview.
     *
     * @param label A label, displayed in the treeview
     * @param onClick An action handler
     * @param groups Determines when the action should be visible in the treeview
     */
    public registerAction(label: string, groups: string[], onClick: () => void) {
        const id = (this.nextId++).toString();

        // Use internal classes
        this.visibility.registerAction(id, groups);
        this.treeDP.registerAction(label, id, onClick, this.visibility.getVisible(id));
    }

    /**
     * Register a visibility group for the action treeview
     * @param group Name of the group
     * @param visible Whether the group should start as active or not
     */
    public registerVisibilityGroup(group: string, visible?: boolean) {
        // Use internal class
        this.visibility.registerGroup(group, visible ? visible : false);
    }

    /**
     * Update the visibility status of a list of groups
     * @param groups The groups to be updated, prepend an exclamation mark to disable
     */
    public updateVisibility(groups: string[]): void {

        if (new Set(groups.map((group) => group.startsWith("!") ? group.substring(1) : group)).size !== groups.length) {
            throw new Error("Visibility group list contains duplicates and/or conflicts");
        }

        let changes: Array<[string, boolean]> = [];

        // Collect changes from each update
        groups.forEach((group) => {
            changes = changes.concat(this.visibility.setGroupVisible(group));
        });

        // Apply changes
        changes.forEach(([id, isVisible]) => this.treeDP.setVisibility(id, isVisible));

        // Refresh if necessary
        if (changes.length > 0) {
            this.treeDP.refresh();
        }
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
            throw new Error("Action already registered");
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
            action.visible = visible;
        } else {
            throw new Error("Visibility logic very badly broken.");
        }
    }

    /**
     * Triggers a treeview refresh
     */
    public refresh() {
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
