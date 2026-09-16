import * as vscode from "vscode"

import type { VisibilityGroup, VisibilityGroupNegated } from "../types"
import { TmcTreeNode } from "./treenode"
import { Visibility } from "./visibility"

/** A leaf under a tree entry, such as one course under "My Courses". */
export interface TreeEntryChild {
  label: string
  id: string
  command: vscode.Command
}

export interface TreeEntry {
  label: string
  /** Unique across the tree; registering the same id twice throws. */
  id: string
  command: vscode.Command
  /** Visibility groups that must all hold for the entry to show; empty means always. */
  groups: (VisibilityGroup | VisibilityGroupNegated)[]
  /**
   * Called on every render, so the children track their source without a separate
   * update path; call `refresh` once that source changes. A leaf entry omits it.
   */
  children?: () => TreeEntryChild[]
  iconId?: string
}

/**
 * A class for managing the TMC menu treeview.
 */
export default class TmcMenuTree {
  private readonly _treeDP: TmcMenuTreeDataProvider
  private readonly _treeView: vscode.TreeView<TmcTreeNode>
  private readonly _visibility: Visibility

  /**
   * Creates and registers a new instance of TMCMenuTree with given viewId.
   * @param viewId Id of the view passed to `vscode.window.registerTreeDataProvider`
   */
  public constructor(viewId: string) {
    this._treeDP = new TmcMenuTreeDataProvider()
    this._treeView = vscode.window.createTreeView(viewId, { treeDataProvider: this._treeDP })

    this._visibility = new Visibility()
  }

  public dispose(): void {
    this._treeView.dispose()
    this._treeDP.dispose()
  }

  /**
   * Registers an action to be shown in the action treeview.
   *
   * @throws if `entry.id` is already registered.
   */
  public registerAction(entry: TreeEntry): void {
    this._visibility.registerAction(entry.id, entry.groups)
    this._treeDP.registerAction(entry, this._visibility.getVisible(entry.id))
  }

  /** Re-renders the tree, picking up whatever the entries' `children` now yield. */
  public refresh(): void {
    this._treeDP.refresh()
  }

  /**
   * Register a visibility group for the action treeview
   * @param visible Whether the group should start as active or not
   */
  public createVisibilityGroup(visible?: boolean): VisibilityGroup {
    // Use internal class
    return this._visibility.createGroup(visible ? visible : false)
  }

  /**
   * Update the visibility status of a list of groups
   * @param groups The groups to be updated, prepend an exclamation mark to disable
   */
  public updateVisibility(groups: (VisibilityGroup | VisibilityGroupNegated)[]): void {
    if (
      new Set(groups.map((group) => (group.id.startsWith("!") ? group.id.slice(1) : group.id)))
        .size !== groups.length
    ) {
      throw new Error("Visibility group list contains duplicates and/or conflicts")
    }

    let changes: [string, boolean][] = []

    // Collect changes from each update
    groups.forEach((group) => {
      changes = changes.concat(this._visibility.setGroupVisible(group))
    })

    // Apply changes
    changes.forEach(([id, isVisible]) => this._treeDP.setVisibility(id, isVisible))

    // Refresh if necessary
    if (changes.length > 0) {
      this._treeDP.refresh()
    }
  }
}

/**
 * A class required by VSCode to fulfill the role of a data provider for the action treeview
 */
export class TmcMenuTreeDataProvider implements vscode.TreeDataProvider<TmcTreeNode> {
  /**
   * @implements {vscode.TreeDataProvider<TmcTreeNode>}
   */
  public readonly onDidChangeTreeData: vscode.Event<TmcTreeNode | undefined>

  /**
   * @implements {vscode.TreeDataProvider<TmcTreeNode>}
   */
  private readonly _refreshEventEmitter: vscode.EventEmitter<TmcTreeNode | undefined>

  private _entries: Map<string, { entry: TreeEntry; visible: boolean }>

  /**
   * Creates new instance of TMC treeview.
   */
  public constructor() {
    this._refreshEventEmitter = new vscode.EventEmitter<TmcTreeNode | undefined>()
    this.onDidChangeTreeData = this._refreshEventEmitter.event
    this._entries = new Map<string, { entry: TreeEntry; visible: boolean }>()
  }

  public dispose(): void {
    this._refreshEventEmitter.dispose()
  }

  /**
   * @implements {vscode.TreeDataProvider<TmcTreeNode>}
   */
  public getChildren(element?: TmcTreeNode): Thenable<TmcTreeNode[]> {
    if (element) {
      const parent = this._entries.get(element.id)
      if (!parent?.visible) {
        return Promise.resolve([])
      }
      const children = parent.entry.children?.() ?? []
      return Promise.resolve(
        children.map((child) => new TmcTreeNode(child.label, child.id, child.command, "child")),
      )
    }
    const roots = [...this._entries.values()]
      .filter(({ visible }) => visible)
      .map(({ entry }) => TmcMenuTreeDataProvider._rootNode(entry))
    return Promise.resolve(roots)
  }

  /**
   * @implements {vscode.TreeDataProvider<TmcTreeNode>}
   */
  public getTreeItem(element: TmcTreeNode): TmcTreeNode {
    return element
  }

  /**
   * @implements {vscode.TreeDataProvider<TmcTreeNode>}
   */
  public getParent(): TmcTreeNode | undefined {
    return undefined
  }

  /**
   * Internal logic for TmcMenuTree.registerAction
   */
  public registerAction(entry: TreeEntry, visible: boolean): void {
    if (this._entries.get(entry.id) !== undefined) {
      throw new Error(`Action "${entry.id}" already registered`)
    }
    this._entries.set(entry.id, { entry, visible })
    this.refresh()
  }

  /**
   * Internal logic for TmcMenuTree.updateVisibility
   */
  public setVisibility(id: string, visible: boolean): void {
    const entry = this._entries.get(id)

    if (entry) {
      entry.visible = visible
    } else {
      throw new Error("Visibility logic very badly broken.")
    }
  }

  /**
   * Triggers a treeview refresh
   */
  public refresh(): void {
    this._refreshEventEmitter.fire(undefined)
  }

  private static _rootNode(entry: TreeEntry): TmcTreeNode {
    const childCount = entry.children?.().length
    const collapsibleState =
      childCount === undefined
        ? vscode.TreeItemCollapsibleState.None
        : childCount > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
    return new TmcTreeNode(
      entry.label,
      entry.id,
      entry.command,
      "parent",
      collapsibleState,
      entry.iconId,
    )
  }
}
