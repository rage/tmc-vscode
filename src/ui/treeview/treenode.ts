import * as vscode from "vscode"

/**
 * Data class representing an item in the action treeview
 */
export class TmcTreeNode extends vscode.TreeItem {
  public children: Map<string, TmcTreeNode>
  public override readonly id: string

  public constructor(
    label: string,
    id: string,
    command: vscode.Command,
    contextValue?: string,
    collapsibleState?: vscode.TreeItemCollapsibleState,
    subActions?: TmcTreeNode[],
    iconId?: string,
  ) {
    super(label, collapsibleState)
    this.id = id
    if (contextValue !== undefined) {
      this.contextValue = contextValue
    }
    if (iconId !== undefined) {
      this.iconPath = new vscode.ThemeIcon(iconId)
    }
    this.command = command
    this.children = new Map<string, TmcTreeNode>()
    if (subActions) {
      subActions.forEach((child) => this.children.set(child.id, child))
    }
  }
}
