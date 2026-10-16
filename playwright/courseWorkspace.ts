import * as fs from "fs"
import { join } from "node:path"

/** The folder the extension keeps its course workspace files in. */
export function courseWorkspaceFolder(userDataDir: string): string {
  return join(userDataDir, "User", "globalStorage", "moocfi.test-my-code", "workspaces")
}

/** The `settings` of the one course workspace file, or `undefined` while there is none to read. */
export function courseWorkspaceSettings(userDataDir: string): Record<string, unknown> | undefined {
  const folder = courseWorkspaceFolder(userDataDir)
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
