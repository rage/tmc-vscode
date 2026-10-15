import * as path from "path"

import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type Langs from "../../api/langs"
import { findMainSourceFile, showExerciseSourceFile } from "../../window/exerciseSourceFile"
import { makeTmpDirs } from "../utils"

suite("findMainSourceFile", function () {
  test("picks the student's Python module, not the tests or the package marker", async function () {
    const root = makeTmpDirs({
      "src/__init__.py": "",
      "src/arithmetics.py": "",
      "test/test_arithmetics.py": "",
      "tmc/points.py": "",
    })

    expect(await findMainSourceFile(root, ["src"])).toBe(path.join(root, "src/arithmetics.py"))
  })

  test("goes down a Maven source tree", async function () {
    const root = makeTmpDirs({
      "src/main/java/fi/mooc/Program.java": "",
      "src/test/java/fi/mooc/ProgramTest.java": "",
      "pom.xml": "",
    })

    expect(await findMainSourceFile(root, ["src/main"])).toBe(
      path.join(root, "src/main/java/fi/mooc/Program.java"),
    )
  })

  test("prefers the least nested file, then the first by name", async function () {
    const root = makeTmpDirs({
      "src/deep/helper.c": "",
      "src/source.c": "",
      "src/main.c": "",
    })

    expect(await findMainSourceFile(root, ["src"])).toBe(path.join(root, "src/main.c"))
  })

  test("takes a student path naming a file as it is", async function () {
    const root = makeTmpDirs({ "solution.py": "", "src/other.py": "" })

    expect(await findMainSourceFile(root, ["solution.py", "src"])).toBe(
      path.join(root, "solution.py"),
    )
  })

  test("finds nothing in an exercise without source files", async function () {
    const root = makeTmpDirs({ "src/data.txt": "", "README.md": "" })

    expect(await findMainSourceFile(root, ["src", "missing"])).toBeUndefined()
  })
})

suite("showExerciseSourceFile", function () {
  beforeEach(function () {
    vi.spyOn(vscode.window, "showTextDocument").mockResolvedValue({} as vscode.TextEditor)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("opens the main file of the student paths tmc-langs names", async function () {
    const root = makeTmpDirs({ "lib/solution.py": "", "src/other.py": "" })
    const langs = { getStudentFilePaths: vi.fn(async () => Ok(["lib"])) }

    const shown = await showExerciseSourceFile(langs as unknown as Langs, {
      uri: vscode.Uri.file(root),
      exerciseSlug: "solution",
    })

    expect(shown).toBe(true)
    expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: path.join(root, "lib/solution.py") }),
      { preview: false },
    )
  })

  test("falls back to the plugins' default folders when tmc-langs cannot say", async function () {
    const root = makeTmpDirs({ "src/main.py": "" })
    const langs = { getStudentFilePaths: vi.fn(async () => Err(new Error("no plugin"))) }

    const shown = await showExerciseSourceFile(langs as unknown as Langs, {
      uri: vscode.Uri.file(root),
      exerciseSlug: "main",
    })

    expect(shown).toBe(true)
    expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fsPath: path.join(root, "src/main.py") }),
      { preview: false },
    )
  })

  test("opens nothing for an exercise without source files", async function () {
    const root = makeTmpDirs({ "notes.txt": "" })
    const langs = { getStudentFilePaths: vi.fn(async () => Ok(["."])) }

    const shown = await showExerciseSourceFile(langs as unknown as Langs, {
      uri: vscode.Uri.file(root),
      exerciseSlug: "notes",
    })

    expect(shown).toBe(false)
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
  })
})
