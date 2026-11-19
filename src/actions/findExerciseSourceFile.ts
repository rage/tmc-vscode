import { promises as fs } from "fs"
import * as path from "path"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".hs",
  ".java",
  ".js",
  ".kt",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".scala",
  ".ts",
])

/** Folders that hold generated files, tests or tooling rather than the student's code. */
const SKIPPED_FOLDERS = new Set([
  "__pycache__",
  "bin",
  "build",
  "node_modules",
  "obj",
  "target",
  "test",
  "tests",
  "tmc",
])

/** Where a student's code lives when tmc-langs cannot say: every language plugin's default. */
const DEFAULT_STUDENT_PATHS = ["src", "R"]

const MAX_DEPTH = 6
const MAX_ENTRIES = 2000

function isSourceFile(fileName: string): boolean {
  const extension = path.extname(fileName).toLowerCase()
  if (!SOURCE_EXTENSIONS.has(extension)) {
    return false
  }
  const stem = path.basename(fileName, path.extname(fileName))
  return stem !== "__init__" && !/^test_|_test$|Tests?$/.test(stem)
}

/**
 * The source file a student starts an exercise from: among the source files under
 * `studentPaths`, the least deeply nested one, ties broken by path. Test, build and
 * hidden folders are skipped.
 *
 * @param studentPaths Files and folders relative to `exercisePath`.
 */
export async function findMainSourceFile(
  exercisePath: string,
  studentPaths: readonly string[],
): Promise<string | undefined> {
  let found: { file: string; depth: number } | undefined
  let budget = MAX_ENTRIES
  const consider = (file: string, depth: number): void => {
    if (
      !found ||
      depth < found.depth ||
      (depth === found.depth && file.localeCompare(found.file) < 0)
    ) {
      found = { file, depth }
    }
  }
  const visit = async (entry: string, depth: number): Promise<void> => {
    if (budget-- <= 0 || (found && depth > found.depth)) {
      return
    }
    const stat = await fs.stat(entry).catch(() => undefined)
    if (stat?.isFile()) {
      if (isSourceFile(entry)) {
        consider(entry, depth)
      }
      return
    }
    if (!stat?.isDirectory() || depth >= MAX_DEPTH) {
      return
    }
    const children = await fs.readdir(entry).catch(() => [])
    for (const child of children.toSorted()) {
      if (!child.startsWith(".") && !SKIPPED_FOLDERS.has(child)) {
        await visit(path.join(entry, child), depth + 1)
      }
    }
  }
  for (const studentPath of studentPaths) {
    await visit(path.resolve(exercisePath, studentPath), 0)
  }
  return found?.file
}

/**
 * The exercise's main source file, from the student files tmc-langs names for it, else from
 * the language plugins' default folders. `undefined` when the exercise holds no source file.
 */
export async function findExerciseSourceFile(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "uri" | "exerciseSlug">,
): Promise<string | undefined> {
  const exercisePath = exercise.uri.fsPath
  const studentPaths = await actionContext.startup.langs.getStudentFilePaths(exercisePath)
  if (studentPaths.err) {
    Logger.warn(`Could not read the student files of ${exercise.exerciseSlug}`, studentPaths.val)
  }
  return (
    (studentPaths.ok ? await findMainSourceFile(exercisePath, studentPaths.val) : undefined) ??
    (await findMainSourceFile(exercisePath, DEFAULT_STUDENT_PATHS))
  )
}
