import { VisibilityGroup, VisibilityGroupNegated } from "../types";
import { TmcTreeNode } from "./treenode";
import { Visibility } from "./visibility";
import * as vscode from "vscode";

/**
 * A class for managing the TMC menu treeview.
 */
export default class TmcMenuTree {
    private readonly _treeDP: TmcMenuTreeDataProvider;
    private readonly _visibility: Visibility;
    private readonly _treeview: vscode.TreeView<TmcTreeNode>;

    /**
     * Creates and registers a new instance of TMCMenuTree with given viewId.
     * @param viewId Id of the view passed to `vscode.window.registerTreeDataProvider`
     */
    constructor(viewId: string) {
        this._treeDP = new TmcMenuTreeDataProvider();
        this._treeview = vscode.window.createTreeView(viewId, { treeDataProvider: this._treeDP });

        this._visibility = new Visibility();
    }

    /**
     * Register an action to be shown in the action treeview.
     *
     * @param label A label, displayed in the treeview
     * @param onClick An action handler
     * @param groups Determines when the action should be visible in the treeview
     * @param id Optional, required for [[triggerCallback]]
     */
    public registerAction(
        label: string,
        id: string,
        groups: Array<VisibilityGroup | VisibilityGroupNegated>,
        command: vscode.Command,
        collapsibleState?: vscode.TreeItemCollapsibleState,
        children?: Array<{ label: string; id: string; command: vscode.Command }>,
    ): void {
        // Use internal classes
        this._visibility.registerAction(id, groups);
        this._treeDP.registerAction(
            label,
            id,
            command,
            this._visibility.getVisible(id),
            collapsibleState,
            children,
        );
    }

    /**
     * Removes child from TreeView item.
     * @param parentId Parent node ID
     * @param removeId Child node ID
     */
    public removeChildWithId(parentId: string, removeId: string): void {
        this._treeDP.removeChildWithId(parentId, removeId);
    }

    /**
     * Adds a child to the TreeView item.
     * @param parentId Parent ID in treeview
     * @param childId Child ID in treeview
     * @param title Human readable text for child item, e.g. course title or name
     * @param command The vscode command to be called when pressing the child node.
     */
    public addChildWithId(
        parentId: string,
        childId: number,
        title: string,
        command: vscode.Command,
    ): void {
        const childIdString = childId.toString();
        this._treeDP.addChildWithId(
            parentId,
            childIdString,
            new TmcTreeNode(title, childIdString, command, "child"),
        );
    }

    /**
     * Register a visibility group for the action treeview
     * @param group Name of the group
     * @param visible Whether the group should start as active or not
     */
    public createVisibilityGroup(visible?: boolean): VisibilityGroup {
        // Use internal class
        return this._visibility.createGroup(visible ? visible : false);
    }

    /**
     * Update the visibility status of a list of groups
     * @param groups The groups to be updated, prepend an exclamation mark to disable
     */
    public updateVisibility(groups: Array<VisibilityGroup | VisibilityGroupNegated>): void {
        if (
            new Set(
                groups.map((group) =>
                    group.id.startsWith("!") ? group.id.substring(1) : group.id,
                ),
            ).size !== groups.length
        ) {
            throw new Error("Visibility group list contains duplicates and/or conflicts");
        }

        let changes: Array<[string, boolean]> = [];

        // Collect changes from each update
        groups.forEach((group) => {
            changes = changes.concat(this._visibility.setGroupVisible(group));
        });

        // Apply changes
        changes.forEach(([id, isVisible]) => this._treeDP.setVisibility(id, isVisible));

        // Refresh if necessary
        if (changes.length > 0) {
            this._treeDP.refresh();
        }
    }
}

/**
 * A class required by VSCode to fulfill the role of a data provider for the action treeview
 */
class TmcMenuTreeDataProvider implements vscode.TreeDataProvider<TmcTreeNode> {
    /**
     * @implements {vscode.TreeDataProvider<TmcTreeNode>}
     */
    public readonly onDidChangeTreeData: vscode.Event<TmcTreeNode | undefined>;

    /**
     * @implements {vscode.TreeDataProvider<TmcTreeNode>}
     */
    private _refreshEventEmitter: vscode.EventEmitter<TmcTreeNode | undefined>;

    private _actions: Map<string, { action: TmcTreeNode; visible: boolean }>;

    /**
     * Creates new instance of TMC treeview.
     */
    public constructor() {
        this._refreshEventEmitter = new vscode.EventEmitter<TmcTreeNode | undefined>();
        this.onDidChangeTreeData = this._refreshEventEmitter.event;
        this._actions = new Map<string, { action: TmcTreeNode; visible: boolean }>();
    }

    /**
     * @implements {vscode.TreeDataProvider<TmcTreeNode>}
     */
    public getChildren(element?: TmcTreeNode): Thenable<TmcTreeNode[]> {
        const actionList: TmcTreeNode[] = [];
        if (element) {
            for (const action of this._actions) {
                if (action[1].visible) {
                    action[1].action.children?.forEach((child) => actionList.push(child));
                }
            }
            return Promise.resolve(actionList);
        } else {
            for (const action of this._actions) {
                if (action[1].visible) {
                    actionList.push(action[1].action);
                }
            }
            return Promise.resolve(actionList);
        }
    }

    public removeChildWithId(parentId: string, childId: string): void {
        this._actions.get(parentId)?.action.children.delete(childId);
        this.refresh();
    }

    public addChildWithId(parentId: string, childId: string, node: TmcTreeNode): void {
        this._actions.get(parentId)?.action.children.set(childId, node);
        this.refresh();
    }

    /**
     * @implements {vscode.TreeDataProvider<TmcTreeNode>}
     */
    public getTreeItem(element: TmcTreeNode): TmcTreeNode {
        return element;
    }

    /**
     * @implements {vscode.TreeDataProvider<TmcTreeNode>}
     */
    public getParent(): TmcTreeNode | undefined {
        return undefined;
    }

    /**
     * Internal logic for TmcMenuTree.registerAction
     */
    public registerAction(
        label: string,
        id: string,
        command: vscode.Command,
        visible: boolean,
        collapsibleState?: vscode.TreeItemCollapsibleState,
        children?: Array<{ label: string; id: string; command: vscode.Command }>,
    ): void {
        if (this._actions.get(label) !== undefined) {
            throw new Error("Action already registered");
        }
        this._actions.set(id, {
            action: new TmcTreeNode(
                label,
                id,
                command,
                "parent",
                collapsibleState,
                children?.map((c) => new TmcTreeNode(c.label, c.id, c.command, "child")),
            ),
            visible,
        });
        this.refresh();
    }

    /**
     * Internal logic for TmcMenuTree.registerAction
     */
    public setVisibility(id: string, visible: boolean): void {
        const action = this._actions.get(id);

        if (action) {
            action.visible = visible;
        } else {
            throw new Error("Visibility logic very badly broken.");
        }
    }

    /**
     * Triggers a treeview refresh
     */
    public refresh(): void {
        this._refreshEventEmitter.fire(undefined);
    }

    /**
     * Returns an action by id
     *
     * @param id
     */
    public getAction(id: string): { action: TmcTreeNode; visible: boolean } | undefined {
        return this._actions.get(id);
    }
}
