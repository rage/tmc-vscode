import * as vscode from "vscode"

import {
  closeExerciseEditors,
  revertExerciseDocuments,
  saveExerciseDocuments,
} from "../../window/exerciseDocuments"

const exercise = { uri: vscode.Uri.file("/projects/course/exercise") }

function document(fsPath: string, isDirty: boolean, saves = true): vscode.TextDocument {
  return {
    uri: vscode.Uri.file(fsPath),
    isDirty,
    save: vi.fn(async () => saves),
  } as unknown as vscode.TextDocument
}

function openDocuments(...documents: vscode.TextDocument[]): void {
  Object.defineProperty(vscode.workspace, "textDocuments", {
    value: documents,
    configurable: true,
  })
}

afterEach(function () {
  openDocuments()
  Object.defineProperty(vscode.window, "activeTextEditor", { value: undefined, configurable: true })
})

suite("saveExerciseDocuments", function () {
  test("saves the exercise's unsaved documents, and no one else's", async function () {
    const inside = document("/projects/course/exercise/src/main.py", true)
    const saved = document("/projects/course/exercise/src/other.py", false)
    const sibling = document("/projects/course/exercise-2/src/main.py", true)
    openDocuments(inside, saved, sibling)

    const result = await saveExerciseDocuments(exercise)

    expect(result.ok).toBe(true)
    expect(inside.save).toHaveBeenCalledOnce()
    expect(saved.save).not.toHaveBeenCalled()
    expect(sibling.save).not.toHaveBeenCalled()
  })

  test("errs naming a document that could not be saved", async function () {
    openDocuments(document("/projects/course/exercise/src/main.py", true, false))

    const result = await saveExerciseDocuments(exercise)

    expect(result.err && result.val.message).toBe("Could not save main.py.")
  })
})

suite("revertExerciseDocuments", function () {
  test("reverts each unsaved document of the exercise in turn, then refocuses the editor", async function () {
    const inside = document("/projects/course/exercise/src/main.py", true)
    const outside = document("/projects/other/main.py", true)
    openDocuments(inside, outside)
    const previous = { document: outside, viewColumn: 2 }
    Object.defineProperty(vscode.window, "activeTextEditor", {
      value: previous,
      configurable: true,
    })
    const shown: unknown[] = []
    vi.spyOn(vscode.window, "showTextDocument").mockImplementation(async (shownDocument) => {
      shown.push(shownDocument)
      return {} as vscode.TextEditor
    })

    await revertExerciseDocuments(exercise)

    expect(shown).toEqual([inside, outside])
    expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.files.revert",
    )
  })

  test("touches no editor when nothing of the exercise is unsaved", async function () {
    openDocuments(document("/projects/course/exercise/src/main.py", false))
    const showTextDocument = vi.spyOn(vscode.window, "showTextDocument")

    await revertExerciseDocuments(exercise)

    expect(showTextDocument).not.toHaveBeenCalled()
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  })
})

suite("closeExerciseEditors", function () {
  test("closes the tabs showing the exercise's files only", async function () {
    const inside = { input: { uri: vscode.Uri.file("/projects/course/exercise/src/main.py") } }
    const outside = { input: { uri: vscode.Uri.file("/projects/course/other/main.py") } }
    const webview = { input: { viewType: "tmc" } }
    const close = vi.fn(async () => true)
    Object.defineProperty(vscode.window, "tabGroups", {
      value: { all: [{ tabs: [inside, webview] }, { tabs: [outside] }], close },
      configurable: true,
    })

    await closeExerciseEditors(exercise)

    expect(close).toHaveBeenCalledExactlyOnceWith([inside])
  })
})
