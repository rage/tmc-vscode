import * as path from "path"

import * as vscode from "vscode"

import type { TestResult } from "../shared/langsSchema"
import type { SourceFileFinder } from "./sourceFiles"
import type { StackFrame } from "./stackTrace"
import { parseStackTrace } from "./stackTrace"

// JUnit 4's `expected:<3> but was:<4>` and JUnit 5's `expected: <3> but was: <4>`.
const JUNIT_COMPARISON = /expected: ?<(?<expected>[\s\S]*)> but was: ?<(?<actual>[\s\S]*)>/

/**
 * The message a failed test is reported with: a diff when the assertion names what it
 * expected, located at the innermost stack frame inside the exercise.
 */
export async function failureMessage(
  result: TestResult,
  exercisePath: string,
  findFile?: SourceFileFinder,
): Promise<vscode.TestMessage> {
  const { frames, details } = await parseStackTrace(result.exception, exercisePath, findFile)
  const text = result.message || details.join("\n") || "The test failed."
  const comparison = JUNIT_COMPARISON.exec(text)?.groups
  const message =
    comparison?.expected !== undefined && comparison.actual !== undefined
      ? vscode.TestMessage.diff(text, comparison.expected, comparison.actual)
      : new vscode.TestMessage(text)

  message.stackTrace = frames.map(
    ({ label, file, line }) =>
      new vscode.TestMessageStackFrame(
        label,
        file === undefined ? undefined : vscode.Uri.file(file),
        line === undefined ? undefined : new vscode.Position(line - 1, 0),
      ),
  )
  const located = frames.find((frame) => isInExercise(frame, exercisePath))
  if (located?.file !== undefined && located.line !== undefined) {
    message.location = new vscode.Location(
      vscode.Uri.file(located.file),
      new vscode.Position(located.line - 1, 0),
    )
  }
  return message
}

// Python exercises ship their test helpers in `tmc/`; a failure inside one belongs to the
// test that called it.
function isInExercise(frame: StackFrame, exercisePath: string): boolean {
  if (frame.file === undefined) {
    return false
  }
  const relative = path.relative(exercisePath, frame.file)
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    relative.split(path.sep)[0] !== "tmc"
  )
}
