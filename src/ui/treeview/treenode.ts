import * as vscode from "vscode";

/**
 * Data class representing an item in the action treeview
 */
export class TmcTreeNode extends vscode.TreeItem {
    public children: Map<string, TmcTreeNode>;
    public readonly id: string;

    constructor(
        label: string,
        id: string,
        command: vscode.Command,
        contextValue?: string,
        collapsibleState?: vscode.TreeItemCollapsibleState,
        subActions?: TmcTreeNode[],
    ) {
        super(label, collapsibleState);
        this.id = id;
        this.contextValue = contextValue;
        this.command = command;
        this.children = new Map<string, TmcTreeNode>();
        if (subActions) {
            subActions.forEach((child) => this.children.set(child.id, child));
        }
    }
}
