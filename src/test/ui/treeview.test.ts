import * as vscode from "vscode"

import type { TreeEntryChild } from "../../ui/treeview/treeview"
import TmcMenuTree, { TmcMenuTreeDataProvider } from "../../ui/treeview/treeview"

const command: vscode.Command = { command: "tmc.noop", title: "" }

function leaf(id: string): { label: string; id: string; command: vscode.Command; groups: [] } {
  return { label: id, id, command, groups: [] }
}

suite("TmcMenuTree", function () {
  let tree: TmcMenuTree
  let dataProvider: vscode.TreeDataProvider<vscode.TreeItem>

  beforeEach(function () {
    // jest-mock-vscode's createTreeView returns nothing; the tree keeps the view
    // to dispose it, and the test drives the provider it hands over.
    vi.spyOn(vscode.window, "createTreeView").mockImplementation(((
      _viewId: string,
      options: { treeDataProvider: vscode.TreeDataProvider<vscode.TreeItem> },
    ) => {
      dataProvider = options.treeDataProvider
      return { dispose: (): void => {} }
    }) as never)
    tree = new TmcMenuTree("tmcView")
  })

  afterEach(function () {
    tree.dispose()
    vi.restoreAllMocks()
  })

  test("registering the same id twice throws", function () {
    tree.registerAction(leaf("settings"))
    expect(() => tree.registerAction({ ...leaf("settings"), label: "Something else" })).toThrow()
  })

  test("children are resolved per render, so a new course needs no tree bookkeeping", async function () {
    const courses: TreeEntryChild[] = []
    tree.registerAction({
      ...leaf("myCourses"),
      children: () => courses,
    })
    const [myCourses] = (await dataProvider.getChildren()) ?? []
    expect(myCourses?.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed)
    expect(await dataProvider.getChildren(myCourses)).toEqual([])

    courses.push({ label: "The Python Course", id: "1", command })
    const [expanded] = (await dataProvider.getChildren()) ?? []
    expect(expanded?.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded)
    const rendered = await dataProvider.getChildren(expanded)
    expect(rendered?.map((child) => child.label)).toEqual(["The Python Course"])
  })

  test("only the queried entry's children are returned", async function () {
    tree.registerAction({
      ...leaf("myCourses"),
      children: () => [{ label: "c", id: "c", command }],
    })
    tree.registerAction(leaf("settings"))
    const roots = (await dataProvider.getChildren()) ?? []
    const settings = roots.find((root) => root.id === "settings")
    expect(settings?.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None)
    expect(await dataProvider.getChildren(settings)).toEqual([])
  })

  test("an entry is rendered only while its visibility groups hold", async function () {
    const loggedIn = tree.createVisibilityGroup(false)
    tree.registerAction({ ...leaf("logOut"), groups: [loggedIn] as never })
    tree.registerAction({ ...leaf("logIn"), groups: [loggedIn.not] as never })
    expect(((await dataProvider.getChildren()) ?? []).map((root) => root.id)).toEqual(["logIn"])
    tree.updateVisibility([loggedIn])
    expect(((await dataProvider.getChildren()) ?? []).map((root) => root.id)).toEqual(["logOut"])
  })
})

// Entries are stored by id, so the provider's own duplicate check has to be keyed
// on the id: a check on the label lets a second entry silently replace the first.
suite("TmcMenuTreeDataProvider", function () {
  test("a repeated id is rejected rather than replacing the entry already there", async function () {
    const dataProvider = new TmcMenuTreeDataProvider()
    dataProvider.registerAction({ ...leaf("myCourses"), label: "My Courses" }, true)

    expect(() =>
      dataProvider.registerAction({ ...leaf("myCourses"), label: "Other courses" }, true),
    ).toThrow()

    const roots = await dataProvider.getChildren()
    expect(roots.map((root) => root.label)).toEqual(["My Courses"])
    dataProvider.dispose()
  })
})
