import * as fs from "fs"
import { join } from "node:path"

/**
 * The exercises folder tmc-langs makes of the `projectsDir` fixture, which it names after the
 * client; every course workspace lists it first.
 */
export function exercisesFolder(projectsDir: string): string {
  return join(projectsDir, "vscode")
}

/** The folder the extension keeps its course workspace files in. */
export function courseWorkspaceFolder(projectsDir: string): string {
  return join(exercisesFolder(projectsDir), "workspaces")
}

/** The `settings` of the one course workspace file, or `undefined` while there is none to read. */
export function courseWorkspaceSettings(projectsDir: string): Record<string, unknown> | undefined {
  const folder = courseWorkspaceFolder(projectsDir)
  try {
    const [workspaceFile] = fs.readdirSync(folder).filter((f) => f.endsWith(".code-workspace"))
    if (!workspaceFile) {
      return undefined
    }
    return JSON.parse(fs.readFileSync(join(folder, workspaceFile), "utf-8")).settings
  } catch {
    return undefined
  }
}
