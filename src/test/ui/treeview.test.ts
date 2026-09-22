import * as vscode from "vscode"

import type { TreeEntry, TreeEntryChild } from "../../ui/treeview/treeview"
import TmcMenuTree, { TmcMenuTreeDataProvider } from "../../ui/treeview/treeview"

const command: vscode.Command = { command: "tmc.noop", title: "" }

function leaf(id: string): TreeEntry {
  return { label: id, id, command, visible: "always" }
}

suite("TmcMenuTree", function () {
  let tree: TmcMenuTree
  let dataProvider: vscode.TreeDataProvider<vscode.TreeItem>
  let disposeView: ReturnType<typeof vi.fn>

  beforeEach(function () {
    disposeView = vi.fn()
    // jest-mock-vscode's createTreeView returns nothing; the tree keeps the view
    // to dispose it, and the test drives the provider it hands over.
    vi.spyOn(vscode.window, "createTreeView").mockImplementation(((
      _viewId: string,
      options: { treeDataProvider: vscode.TreeDataProvider<vscode.TreeItem> },
    ) => {
      dataProvider = options.treeDataProvider
      return { dispose: disposeView }
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

  test("a refresh re-renders the whole tree, not one node", function () {
    const refreshed: unknown[] = []
    dataProvider.onDidChangeTreeData?.((node) => refreshed.push(node))
    tree.registerAction(leaf("settings"))
    tree.refresh()

    expect(refreshed).toEqual([undefined, undefined])
  })

  test("an icon requested for an entry reaches the rendered node", async function () {
    tree.registerAction({ ...leaf("myCourses"), iconId: "book" })
    const [rendered] = (await dataProvider.getChildren()) ?? []

    expect((rendered?.iconPath as vscode.ThemeIcon | undefined)?.id).toBe("book")
  })

  test("a child's description is rendered dimmed beside its own label, not folded into it", async function () {
    tree.registerAction({
      ...leaf("myCourses"),
      children: () => [
        { label: "Introduction to CS", id: "course-uuid", command, description: "courses.mooc.fi" },
      ],
    })
    const [myCourses] = (await dataProvider.getChildren()) ?? []
    const [rendered] = (await dataProvider.getChildren(myCourses)) ?? []

    expect(rendered?.label).toBe("Introduction to CS")
    expect(rendered?.description).toBe("courses.mooc.fi")
  })

  test("disposing releases the view and stops further refresh events", function () {
    const refreshed: unknown[] = []
    dataProvider.onDidChangeTreeData?.((node) => refreshed.push(node))
    tree.dispose()
    tree.refresh()

    expect(disposeView).toHaveBeenCalledOnce()
    expect(refreshed).toEqual([])
  })

  test("the login state decides which of the two halves is rendered", async function () {
    tree.registerAction({ ...leaf("logOut"), visible: "loggedIn" })
    tree.registerAction({ ...leaf("logIn"), visible: "loggedOut" })
    expect(((await dataProvider.getChildren()) ?? []).map((root) => root.id)).toEqual(["logIn"])
    tree.setLoggedIn(true)
    expect(((await dataProvider.getChildren()) ?? []).map((root) => root.id)).toEqual(["logOut"])
  })

  // Activation learns the login state before it has any entries to register.
  test("an entry registered after the login state picks it up", async function () {
    tree.setLoggedIn(true)
    tree.registerAction({ ...leaf("myCourses"), visible: "loggedIn" })

    expect(((await dataProvider.getChildren()) ?? []).map((root) => root.id)).toEqual(["myCourses"])
  })
})

suite("TmcMenuTreeDataProvider", function () {
  test("a hidden entry yields no children even when asked for them directly", async function () {
    const dataProvider = new TmcMenuTreeDataProvider()
    dataProvider.registerAction({
      ...leaf("myCourses"),
      visible: "loggedIn",
      children: () => [{ label: "The Python Course", id: "1", command }],
    })
    dataProvider.setLoggedIn(true)
    const [myCourses] = await dataProvider.getChildren()
    expect(await dataProvider.getChildren(myCourses)).toHaveLength(1)

    dataProvider.setLoggedIn(false)

    expect(await dataProvider.getChildren()).toEqual([])
    expect(await dataProvider.getChildren(myCourses)).toEqual([])
    dataProvider.dispose()
  })

  // Entries are stored by id, so the provider's own duplicate check has to be keyed
  // on the id: a check on the label lets a second entry silently replace the first.
  test("a repeated id is rejected rather than replacing the entry already there", async function () {
    const dataProvider = new TmcMenuTreeDataProvider()
    dataProvider.registerAction({ ...leaf("myCourses"), label: "My Courses" })

    expect(() =>
      dataProvider.registerAction({ ...leaf("myCourses"), label: "Other courses" }),
    ).toThrow()

    const roots = await dataProvider.getChildren()
    expect(roots.map((root) => root.label)).toEqual(["My Courses"])
    dataProvider.dispose()
  })
})
