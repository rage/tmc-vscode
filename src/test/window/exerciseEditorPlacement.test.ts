import * as vscode from "vscode"

import { keepExerciseFilesInFirstGroup } from "../../window/exerciseEditorPlacement"

const exerciseFile = vscode.Uri.file("/exercises/course/hello/src/main.py")
const otherFile = vscode.Uri.file("/notes/todo.md")
const resultsTab = { input: { viewType: "mainThreadWebview-tmc.sidePanel" } }
const courseHomeTab = { input: { viewType: "mainThreadWebview-tmc.mainPanel" } }

function withGroups(...groups: { viewColumn: number; tabs: unknown[] }[]): void {
  Object.defineProperty(vscode.window, "tabGroups", {
    value: { all: groups, activeTabGroup: groups[0] },
    configurable: true,
  })
}

suite("keepExerciseFilesInFirstGroup", function () {
  const initialTabGroups = vscode.window.tabGroups
  let activeEditorChanged: vscode.EventEmitter<vscode.TextEditor | undefined>
  let placement: vscode.Disposable

  beforeEach(function () {
    activeEditorChanged = new vscode.EventEmitter()
    vi.spyOn(vscode.window, "onDidChangeActiveTextEditor").mockImplementation(
      activeEditorChanged.event,
    )
    vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    placement = keepExerciseFilesInFirstGroup((uri) => uri.fsPath.startsWith("/exercises/"))
  })

  afterEach(function () {
    placement.dispose()
    vi.restoreAllMocks()
    Object.defineProperty(vscode.window, "tabGroups", {
      value: initialTabGroups,
      configurable: true,
    })
  })

  function open(uri: vscode.Uri, viewColumn: vscode.ViewColumn): void {
    activeEditorChanged.fire({ document: { uri }, viewColumn } as vscode.TextEditor)
  }

  test("moves an exercise file opened beside a TestMyCode screen to the first group", function () {
    for (const screenTab of [resultsTab, courseHomeTab]) {
      vi.mocked(vscode.commands.executeCommand).mockClear()
      withGroups({ viewColumn: 1, tabs: [] }, { viewColumn: 2, tabs: [screenTab] })

      open(exerciseFile, vscode.ViewColumn.Two)

      expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
        "workbench.action.moveEditorToFirstGroup",
      )
    }
  })

  test("leaves files in the first group, other files, and groups the student made", function () {
    withGroups(
      { viewColumn: 1, tabs: [courseHomeTab] },
      { viewColumn: 2, tabs: [resultsTab] },
      { viewColumn: 3, tabs: [] },
    )

    open(exerciseFile, vscode.ViewColumn.One)
    open(otherFile, vscode.ViewColumn.Two)
    open(exerciseFile, vscode.ViewColumn.Three)
    activeEditorChanged.fire(undefined)

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  })
})
