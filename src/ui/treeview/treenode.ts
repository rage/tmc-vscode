import * as vscode from "vscode"

/**
 * Data class representing an item in the action treeview
 */
export class TmcTreeNode extends vscode.TreeItem {
  public override readonly id: string

  public constructor(
    label: string,
    id: string,
    command: vscode.Command,
    contextValue?: string,
    collapsibleState?: vscode.TreeItemCollapsibleState,
    iconId?: string,
    description?: string,
  ) {
    super(label, collapsibleState)
    this.id = id
    if (contextValue !== undefined) {
      this.contextValue = contextValue
    }
    if (iconId !== undefined) {
      this.iconPath = new vscode.ThemeIcon(iconId)
    }
    if (description !== undefined) {
      this.description = description
    }
    this.command = command
  }
}
