import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { isPathInside, Logger } from "../utilities"

type ExerciseFolder = Pick<WorkspaceExercise, "uri">

function isInside(exercise: ExerciseFolder, uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false
  }
  return isPathInside(exercise.uri.fsPath, uri.fsPath)
}

/** The open text documents of files inside `exercise`'s folder. */
function exerciseDocuments(exercise: ExerciseFolder): vscode.TextDocument[] {
  return vscode.workspace.textDocuments.filter((document) => isInside(exercise, document.uri))
}

/**
 * Saves `exercise`'s unsaved documents, so that what is tested or submitted is what its
 * editors show.
 *
 * @returns `Err` when one of them could not be saved.
 */
export async function saveExerciseDocuments(
  exercise: ExerciseFolder,
): Promise<Result<void, Error>> {
  const unsaved = exerciseDocuments(exercise).filter((document) => document.isDirty)
  const saved = await Promise.all(unsaved.map((document) => document.save()))
  const failed = unsaved.filter((_document, index) => !saved[index])
  return failed.length === 0
    ? Ok.EMPTY
    : Err(
        new Error(
          `Could not save ${failed.map((document) => path.basename(document.uri.fsPath)).join(", ")}.`,
        ),
      )
}

/** The editor tabs showing a file inside `exercise`'s folder. */
function exerciseTabs(exercise: ExerciseFolder): { tab: vscode.Tab; uri: vscode.Uri }[] {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.flatMap((tab) => {
      // Every tab input that shows one resource names it `uri`; a diff edits its `modified`.
      const input = tab.input as { uri?: vscode.Uri; modified?: vscode.Uri } | undefined
      const uri = input?.uri ?? input?.modified
      return uri !== undefined && isInside(exercise, uri) ? [{ tab, uri }] : []
    }),
  )
}

// The revert command reverts whatever editor is active when it runs, and a webview the student
// was in, such as the History that asked for a restore, can take that back after it is shown.
const REVERT_ATTEMPTS = 3

/**
 * Reloads every editor of `exercise`'s files from disk after its folder was rewritten there,
 * discarding unsaved edits. A saved editor needs it too: the CLI replaces the folder, and VS
 * Code stops watching a file whose folder is deleted.
 */
export async function revertExerciseDocuments(exercise: ExerciseFolder): Promise<void> {
  const tabs = exerciseTabs(exercise)
  if (tabs.length === 0) {
    return
  }
  const previous = vscode.window.activeTextEditor
  for (const { tab, uri } of tabs) {
    for (let attempt = 1; ; attempt++) {
      const document = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(document, {
        viewColumn: tab.group.viewColumn,
        preview: false,
      })
      // The revert command ignores any argument.
      await vscode.commands.executeCommand("workbench.action.files.revert")
      if (await showsDiskContent(document)) {
        break
      }
      if (attempt === REVERT_ATTEMPTS) {
        Logger.warn(`Could not reload ${uri.fsPath} from disk`)
        break
      }
    }
  }
  if (previous) {
    await vscode.window.showTextDocument(previous.document, previous.viewColumn)
  }
}

/** Whether `document` holds its file as it is on disk; true when the file cannot be read. */
async function showsDiskContent(document: vscode.TextDocument): Promise<boolean> {
  let onDisk: string
  try {
    onDisk = new TextDecoder().decode(await vscode.workspace.fs.readFile(document.uri))
  } catch {
    return true
  }
  return withoutBomOrCrlf(document.getText()) === withoutBomOrCrlf(onDisk)
}

// A document's text leaves out the file's BOM, and its line endings can be the editor's own.
function withoutBomOrCrlf(text: string): string {
  return text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n")
}

/**
 * Closes every editor tab showing a file inside `exercise`'s folder. VS Code asks about each
 * one with unsaved changes.
 *
 * @returns `false` when a tab stayed open, as when the user cancelled that question.
 */
export async function closeExerciseEditors(exercise: ExerciseFolder): Promise<boolean> {
  const tabs = exerciseTabs(exercise).map(({ tab }) => tab)
  return tabs.length === 0 || (await vscode.window.tabGroups.close(tabs))
}
