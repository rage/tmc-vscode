import * as path from "path"

import type { SourceFileFinder } from "./sourceFiles"
import { createSourceFileFinder } from "./sourceFiles"

/** One frame of a failed test's stack trace. */
export interface StackFrame {
  label: string
  /** Absolute path; unset when the frame is not in a file the editor can open. */
  file?: string
  /** 1-based. */
  line?: number
}

/** A failed test's `exception` lines, split into its stack frames and the rest. */
export interface StackTrace {
  /** Innermost first. */
  frames: StackFrame[]
  /** The lines that are not frames, such as the exception's own message. */
  details: string[]
}

// `File "/path/test/test_hello.py", line 12, in test_first`, from Python's `traceback.format_tb`.
const PYTHON_FRAME = /^\s*File "(?<file>[^"]+)", line (?<line>\d+)(?:, in (?<label>.+))?$/
// `Hello.java:42: fi.helsinki.Hello.greet`, from tmc-langs' Java plugin; the file is omitted
// when unknown.
const TMC_JAVA_FRAME = /^(?:(?<file>[\w$]+\.java):)?(?<line>-?\d+): (?<method>[\w$.<>]+)$/
// `at fi.helsinki.Hello.greet(Hello.java:42)`, Java's own format.
const JAVA_FRAME = /^\s*at (?<method>[\w$.<>/]+)\((?<file>[\w$]+\.java):(?<line>\d+)\)$/
// The JDK's and the test frameworks' classes, which an exercise's sources never hold.
const LIBRARY_CLASS = /^(?:java|javax|jdk|sun|com\.sun|org\.junit|junit|org\.hamcrest)\./

/**
 * Parses a failed test's `exception` lines as tmc-langs reports them for Python and Java,
 * resolving each frame's file against the exercise where it can.
 *
 * Lines in any other format end up in {@link StackTrace.details}, so an unknown language
 * degrades to a message without frames rather than to nothing.
 */
export async function parseStackTrace(
  exception: readonly string[],
  exercisePath: string,
  findFile: SourceFileFinder = createSourceFileFinder(exercisePath),
): Promise<StackTrace> {
  const pythonFrames: StackFrame[] = []
  const javaFrames: Promise<StackFrame>[] = []
  const details: string[] = []
  for (const line of exception.flatMap((entry) => entry.split("\n"))) {
    const python = PYTHON_FRAME.exec(line)?.groups
    const java = (TMC_JAVA_FRAME.exec(line) ?? JAVA_FRAME.exec(line))?.groups
    if (python?.file !== undefined && python.line !== undefined) {
      pythonFrames.push(pythonFrame(python.file, python.line, python.label, exercisePath))
    } else if (java?.method !== undefined && java.line !== undefined) {
      javaFrames.push(javaFrame(java.method, java.file, Number(java.line), findFile))
    } else if (line.trim() !== "" && !isPythonSourceLine(line, pythonFrames.length)) {
      details.push(line)
    }
  }
  // Python prints the outermost frame first.
  const frames = [...pythonFrames.toReversed(), ...(await Promise.all(javaFrames))]
  return { frames, details }
}

function pythonFrame(
  file: string,
  line: string,
  label: string | undefined,
  exercisePath: string,
): StackFrame {
  const absolute = path.resolve(exercisePath, file)
  return { label: label ?? path.basename(absolute), file: absolute, line: Number(line) }
}

// `format_tb` follows each frame with the source line it points at, indented further.
function isPythonSourceLine(line: string, pythonFrameCount: number): boolean {
  return pythonFrameCount > 0 && /^\s{4,}\S/.test(line)
}

async function javaFrame(
  method: string,
  fileName: string | undefined,
  line: number,
  findFile: SourceFileFinder,
): Promise<StackFrame> {
  const className = method.slice(0, method.lastIndexOf("."))
  if (line <= 0 || LIBRARY_CLASS.test(className)) {
    return { label: method }
  }
  const packagePath = className.includes(".")
    ? className.slice(0, className.lastIndexOf(".")).split(".")
    : []
  const outerClass = (className.split(".").at(-1) ?? className).split("$")[0]
  const file = await findFile(path.join(...packagePath, fileName ?? `${outerClass}.java`))
  return file ? { label: method, file, line } : { label: method }
}
