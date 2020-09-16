import * as vscode from "vscode";
import { TreeItemCollapsibleState } from "vscode";

import { VisibilityGroup, VisibilityGroupNegated } from "../types";

import { Visibility } from "./visibility";

/**
 * A class for managing the TMC menu treeview.
 */
export default class TmcMenuTree {
    private readonly _treeDP: TmcMenuTreeDataProvider;
    private readonly _visibility: Visibility;
    private readonly _treeview: vscode.TreeView<TMCAction>;

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
        onClick: () => void,
        collapsibleState?: TreeItemCollapsibleState,
        children?: Array<{ label: string; id: string; onClick: () => void }>,
    ): void {
        // Use internal classes
        this._visibility.registerAction(id, groups);
        this._treeDP.registerAction(
            label,
            id,
            onClick,
            this._visibility.getVisible(id),
            collapsibleState,
            children,
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
                    group._id.startsWith("!") ? group._id.substring(1) : group._id,
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
class TmcMenuTreeDataProvider implements vscode.TreeDataProvider<TMCAction> {
    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
     */
    public readonly onDidChangeTreeData: vscode.Event<TMCAction | undefined>;

    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
     */
    private _refreshEventEmitter: vscode.EventEmitter<TMCAction | undefined>;

    private _actions: Map<string, { action: TMCAction; visible: boolean }>;

    /**
     * Creates new instance of TMC treeview.
     */
    public constructor() {
        this._refreshEventEmitter = new vscode.EventEmitter<TMCAction | undefined>();
        this.onDidChangeTreeData = this._refreshEventEmitter.event;
        this._actions = new Map<string, { action: TMCAction; visible: boolean }>();
    }

    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
     */
    public getChildren(element?: TMCAction): Thenable<TMCAction[]> {
        const actionList: TMCAction[] = [];
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

    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
     */
    public getTreeItem(element: TMCAction): TMCAction {
        return element;
    }

    /**
     * @implements {vscode.TreeDataProvider<TMCAction>}
     */
    public getParent(): TMCAction | undefined {
        return undefined;
    }

    /**
     * Internal logic for TmcMenuTree.registerAction
     */
    public registerAction(
        label: string,
        id: string,
        onClick: () => void,
        visible: boolean,
        collapsibleState?: TreeItemCollapsibleState,
        children?: Array<{ label: string; id: string; onClick: () => void }>,
    ): void {
        if (this._actions.get(label) !== undefined) {
            throw new Error("Action already registered");
        }
        this._actions.set(id, {
            action: new TMCAction(
                label,
                id,
                { command: "tmcView.activateEntry", title: "", arguments: [onClick] },
                onClick,
                collapsibleState,
                children?.map(
                    (c) =>
                        new TMCAction(
                            c.label,
                            c.id,
                            { command: "tmcView.activateEntry", title: "", arguments: [c.onClick] },
                            c.onClick,
                        ),
                ),
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
    public getAction(id: string): { action: TMCAction; visible: boolean } | undefined {
        return this._actions.get(id);
    }
}

/**
 * Data class representing an item in the action treeview
 */
class TMCAction extends vscode.TreeItem {
    public callback: (() => void) | undefined;
    public children: TMCAction[] | undefined;

    constructor(
        label: string,
        id: string,
        command?: vscode.Command,
        callback?: () => void,
        collapsibleState?: TreeItemCollapsibleState,
        children?: TMCAction[],
    ) {
        super(label, collapsibleState);
        this.id = id;
        this.command = command;
        this.children = children;
        this.callback = callback;
    }
}
