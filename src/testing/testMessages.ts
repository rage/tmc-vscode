import * as path from "path"

import * as vscode from "vscode"

import type { TestResult } from "../../shared/langsSchema"
import { asSentence } from "../../shared/lib"
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

// The CLI reports each error of a chain as a line, outermost first.
const TRACE_LINE = /^Caused by: (?<cause>.+)$/

/** CLI causes reworded for a student, where the CLI's own words name its internals. */
const CAUSE_WORDINGS: [RegExp, string][] = [
  [
    /^No matching plugin found for /,
    "TestMyCode cannot tell what kind of exercise this is: files it needs, such as the test folder, are missing.",
  ],
]

/**
 * The text a local test run that failed before running any test is reported with: the deepest
 * cause first, then where it arose, then `error`'s details.
 *
 * @param suggestsReset Whether the failure can come from the exercise's own files, which a
 *   reset restores; an environment failure such as a missing Python cannot.
 */
export function runFailureText(error: Error, details: string, suggestsReset: boolean): string {
  const causes = details
    .split("\n\n", 1)[0]
    ?.split("\n")
    .flatMap((line) => TRACE_LINE.exec(line)?.groups?.cause ?? [])
  const deepest = causes?.at(-1)
  const context = causes?.at(-2)
  const lines =
    deepest === undefined || deepest === error.message
      ? [`The tests could not be run: ${error.message}`]
      : [
          `The tests could not be run: ${asSentence(reworded(deepest))}`,
          ...(context !== undefined && context !== error.message ? [asSentence(context)] : []),
          asSentence(error.message),
        ]
  if (suggestsReset) {
    lines.push(
      "If the exercise's files are damaged or incomplete, Reset Exercise restores its template.",
    )
  }
  return [lines.join("\n"), details].filter(Boolean).join("\n\n")
}

function reworded(cause: string): string {
  return CAUSE_WORDINGS.find(([pattern]) => pattern.test(cause))?.[1] ?? cause
}
