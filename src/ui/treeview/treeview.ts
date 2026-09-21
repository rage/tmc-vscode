import * as vscode from "vscode"

import { TmcTreeNode } from "./treenode"

/** A leaf under a tree entry, such as one course under "My Courses". */
export interface TreeEntryChild {
  label: string
  id: string
  command: vscode.Command
}

/**
 * When an entry shows. `"loggedIn"` and `"loggedOut"` are the two halves of
 * {@link TmcMenuTree.setLoggedIn}: an entry that needs a session, and the entry
 * that stands in its place without one.
 */
export type TreeEntryVisibility = "always" | "loggedIn" | "loggedOut"

export interface TreeEntry {
  label: string
  /** Unique across the tree; registering the same id twice throws. */
  id: string
  command: vscode.Command
  visible: TreeEntryVisibility
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

  /**
   * Creates and registers a new instance of TMCMenuTree with given viewId.
   * @param viewId Id of the view passed to `vscode.window.registerTreeDataProvider`
   */
  public constructor(viewId: string) {
    this._treeDP = new TmcMenuTreeDataProvider()
    this._treeView = vscode.window.createTreeView(viewId, { treeDataProvider: this._treeDP })
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
    this._treeDP.registerAction(entry)
  }

  /** Re-renders the tree, picking up whatever the entries' `children` now yield. */
  public refresh(): void {
    this._treeDP.refresh()
  }

  /**
   * Swaps the entries that need a session for the ones that stand in without
   * one. Entries registered afterwards pick up the state that was last set.
   */
  public setLoggedIn(loggedIn: boolean): void {
    this._treeDP.setLoggedIn(loggedIn)
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

  private _entries: Map<string, TreeEntry>
  private _loggedIn = false

  /**
   * Creates new instance of TMC treeview.
   */
  public constructor() {
    this._refreshEventEmitter = new vscode.EventEmitter<TmcTreeNode | undefined>()
    this.onDidChangeTreeData = this._refreshEventEmitter.event
    this._entries = new Map<string, TreeEntry>()
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
      if (!parent || !this._isVisible(parent)) {
        return Promise.resolve([])
      }
      const children = parent.children?.() ?? []
      return Promise.resolve(
        children.map((child) => new TmcTreeNode(child.label, child.id, child.command, "child")),
      )
    }
    const roots = [...this._entries.values()]
      .filter((entry) => this._isVisible(entry))
      .map((entry) => TmcMenuTreeDataProvider._rootNode(entry))
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

  public registerAction(entry: TreeEntry): void {
    if (this._entries.has(entry.id)) {
      throw new Error(`Action "${entry.id}" already registered`)
    }
    this._entries.set(entry.id, entry)
    this.refresh()
  }

  public setLoggedIn(loggedIn: boolean): void {
    if (loggedIn === this._loggedIn) {
      return
    }
    this._loggedIn = loggedIn
    this.refresh()
  }

  /**
   * Triggers a treeview refresh
   */
  public refresh(): void {
    this._refreshEventEmitter.fire(undefined)
  }

  private _isVisible(entry: TreeEntry): boolean {
    switch (entry.visible) {
      case "always":
        return true
      case "loggedIn":
        return this._loggedIn
      case "loggedOut":
        return !this._loggedIn
    }
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
