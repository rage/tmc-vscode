import * as path from "path"

import * as vscode from "vscode"

import type { StyleValidationError, StyleValidationResult } from "../shared/langsSchema"
import { findSourceFile } from "./sourceFiles"

/** Shows an exercise's code-quality findings as diagnostics: squiggles plus the Problems panel. */
export class CheckstyleDiagnostics implements vscode.Disposable {
  private readonly _collection: vscode.DiagnosticCollection
  // Keyed by exercise `fsPath`, so one exercise's report replaces only its own files.
  private readonly _filesByExercise = new Map<string, vscode.Uri[]>()

  public constructor(
    collection: vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection(
      "tmc-checkstyle",
    ),
  ) {
    this._collection = collection
  }

  /**
   * Replaces the exercise's diagnostics with those of `result`.
   *
   * @param result `null` (the check did not run) or a `DISABLED` strategy clears them.
   */
  public async report(
    exerciseUri: vscode.Uri,
    result: StyleValidationResult | null,
  ): Promise<void> {
    const severity = severityOf(result)
    const reported =
      severity === undefined
        ? []
        : await Promise.all(
            Object.entries(result?.validation_errors ?? {}).map(
              async ([file, errors]) =>
                [
                  await resolveSourceFile(exerciseUri.fsPath, file),
                  errors.map((error) => toDiagnostic(error, severity)),
                ] as const,
            ),
          )
    this.clear(exerciseUri)
    for (const [uri, diagnostics] of reported) {
      this._collection.set(uri, [...(this._collection.get(uri) ?? []), ...diagnostics])
    }
    if (reported.length > 0) {
      this._filesByExercise.set(
        exerciseUri.fsPath,
        reported.map(([uri]) => uri),
      )
    }
  }

  /** Removes the diagnostics reported for one exercise. */
  public clear(exerciseUri: vscode.Uri): void {
    for (const uri of this._filesByExercise.get(exerciseUri.fsPath) ?? []) {
      this._collection.delete(uri)
    }
    this._filesByExercise.delete(exerciseUri.fsPath)
  }

  /** Removes the diagnostics of every exercise not in `openExercises`, e.g. after a close. */
  public retain(openExercises: readonly vscode.Uri[]): void {
    const kept = new Set(openExercises.map((uri) => uri.fsPath))
    for (const exercisePath of this._filesByExercise.keys()) {
      if (!kept.has(exercisePath)) {
        this.clear(vscode.Uri.file(exercisePath))
      }
    }
  }

  public dispose(): void {
    this._filesByExercise.clear()
    this._collection.dispose()
  }
}

function severityOf(result: StyleValidationResult | null): vscode.DiagnosticSeverity | undefined {
  switch (result?.strategy) {
    case "FAIL":
      return vscode.DiagnosticSeverity.Error
    case "WARN":
      return vscode.DiagnosticSeverity.Warning
    default:
      return undefined
  }
}

// Checkstyle's line and column are 1-based, and column 0 means the finding is about the line.
function toDiagnostic(
  error: StyleValidationError,
  severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic {
  const line = Math.max(error.line - 1, 0)
  const column = Math.max(error.column - 1, 0)
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(line, column, line, Number.MAX_SAFE_INTEGER),
    error.message,
    severity,
  )
  diagnostic.source = "TestMyCode"
  diagnostic.code = error.source_name.split(".").at(-1) ?? error.source_name
  return diagnostic
}

async function resolveSourceFile(exercisePath: string, file: string): Promise<vscode.Uri> {
  if (path.isAbsolute(file)) {
    return vscode.Uri.file(file)
  }
  const found = await findSourceFile(exercisePath, file)
  return vscode.Uri.file(found ?? path.join(exercisePath, file))
}
