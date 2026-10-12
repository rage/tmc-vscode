import * as path from "path"

import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { WorkspaceExercise } from "../api/workspaceManager"

type ExerciseFolder = Pick<WorkspaceExercise, "uri">

function isInside(exercise: ExerciseFolder, uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false
  }
  const relative = path.relative(exercise.uri.fsPath, uri.fsPath)
  return !relative.startsWith("..") && !path.isAbsolute(relative)
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

/**
 * Discards the unsaved edits of `exercise`'s documents after its folder was rewritten on disk;
 * VS Code reloads the saved ones by itself.
 */
export async function revertExerciseDocuments(exercise: ExerciseFolder): Promise<void> {
  const dirty = exerciseDocuments(exercise).filter((document) => document.isDirty)
  if (dirty.length === 0) {
    return
  }
  const previous = vscode.window.activeTextEditor
  for (const document of dirty) {
    // The revert command ignores any argument and reverts the active editor.
    await vscode.window.showTextDocument(document, { preview: false })
    await vscode.commands.executeCommand("workbench.action.files.revert")
  }
  if (previous) {
    await vscode.window.showTextDocument(previous.document, previous.viewColumn)
  }
}

/** Closes every editor tab showing a file inside `exercise`'s folder. */
export async function closeExerciseEditors(exercise: ExerciseFolder): Promise<void> {
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      // Every tab input that shows one resource names it `uri`.
      const uri = (tab.input as { uri?: vscode.Uri } | undefined)?.uri
      return uri !== undefined && isInside(exercise, uri)
    })
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs)
  }
}
