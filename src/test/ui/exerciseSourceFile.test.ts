import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { showExerciseSourceFile } from "../../ui/exerciseSourceFile"
import { createMockActionContext } from "../mocks/actionContext"
import { makeTmpDirs } from "../utils"

function contextWith(
  getStudentFilePaths: () => Promise<Result<string[], Error>>,
): ReadyActionContext {
  return createMockActionContext({
    startup: { langs: { getStudentFilePaths } as unknown as Langs },
  })
}

suite("showExerciseSourceFile", function () {
  const initialTabGroups = vscode.window.tabGroups

  beforeEach(function () {
    vi.spyOn(vscode.window, "showTextDocument").mockResolvedValue({} as vscode.TextEditor)
  })

  afterEach(function () {
    vi.restoreAllMocks()
    Object.defineProperty(vscode.window, "tabGroups", {
      value: initialTabGroups,
      configurable: true,
    })
  })

  test("opens the main file of the student paths tmc-langs names", async function () {
    const root = makeTmpDirs({ "lib/solution.py": "", "src/other.py": "" })
    const context = contextWith(async () => Ok(["lib"]))

    const shown = await showExerciseSourceFile(context, {
      uri: vscode.Uri.file(root),
      exerciseSlug: "solution",
    })

    expect(shown).toBe(true)
    expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        fsPath: vscode.Uri.file(path.join(root, "lib/solution.py")).fsPath,
      }),
      { preview: false, viewColumn: vscode.ViewColumn.One },
    )
  })

  test("falls back to the plugins' default folders when tmc-langs cannot say", async function () {
    const root = makeTmpDirs({ "src/main.py": "" })
    const context = contextWith(async () => Err(new Error("no plugin")))

    const shown = await showExerciseSourceFile(context, {
      uri: vscode.Uri.file(root),
      exerciseSlug: "main",
    })

    expect(shown).toBe(true)
    expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: vscode.Uri.file(path.join(root, "src/main.py")).fsPath }),
      { preview: false, viewColumn: vscode.ViewColumn.One },
    )
  })

  test("opens the file in the first group, not in the active one holding the results", async function () {
    const root = makeTmpDirs({ "src/main.py": "" })
    const code = { viewColumn: 1, tabs: [{ input: { uri: vscode.Uri.file("/other.py") } }] }
    const result = {
      viewColumn: 2,
      tabs: [{ input: { viewType: "mainThreadWebview-tmc.sidePanel" } }],
    }
    Object.defineProperty(vscode.window, "tabGroups", {
      value: { all: [code, result], activeTabGroup: result },
      configurable: true,
    })
    const context = contextWith(async () => Ok(["src"]))

    await showExerciseSourceFile(context, { uri: vscode.Uri.file(root), exerciseSlug: "main" })

    expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: vscode.Uri.file(path.join(root, "src/main.py")).fsPath }),
      { preview: false, viewColumn: 1 },
    )
  })

  test("focuses the tab already showing the file instead of opening another", async function () {
    const root = makeTmpDirs({ "src/main.py": "" })
    const file = vscode.Uri.file(path.join(root, "src/main.py"))
    const other = { viewColumn: 1, tabs: [{ input: { uri: vscode.Uri.file("/other.py") } }] }
    const showing = { viewColumn: 3, tabs: [{ input: { uri: file } }] }
    Object.defineProperty(vscode.window, "tabGroups", {
      value: { all: [other, showing], activeTabGroup: other },
      configurable: true,
    })
    const context = contextWith(async () => Ok(["src"]))

    await showExerciseSourceFile(context, { uri: vscode.Uri.file(root), exerciseSlug: "main" })

    expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: file.fsPath }),
      { preview: false, viewColumn: 3 },
    )
  })

  test("opens nothing for an exercise without source files", async function () {
    const root = makeTmpDirs({ "notes.txt": "" })
    const context = contextWith(async () => Ok(["."]))

    const shown = await showExerciseSourceFile(context, {
      uri: vscode.Uri.file(root),
      exerciseSlug: "notes",
    })

    expect(shown).toBe(false)
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
  })

  test("a file the editor cannot show is not the open's failure", async function () {
    const root = makeTmpDirs({ "src/main.py": "" })
    vi.mocked(vscode.window.showTextDocument).mockRejectedValue(new Error("binary file"))
    const context = contextWith(async () => Ok(["src"]))

    const shown = await showExerciseSourceFile(context, {
      uri: vscode.Uri.file(root),
      exerciseSlug: "main",
    })

    expect(shown).toBe(false)
  })
})
