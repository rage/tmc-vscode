import * as fs from "fs"
import * as path from "path"

import { TMC_LANGS_CONFIG_DIR } from "./config/constants"
import { CREDENTIALS_FILE, cliConfigFolder } from "./init/cliConfigFolder"

/**
 * Removes the logins the CLI stored, so the next person to install TestMyCode on a shared
 * computer is not logged in as this one. Exercises stay. Run by VS Code's `vscode:uninstall`
 * hook, outside the extension host, so it cannot use the `vscode` API.
 *
 * @returns The credential files removed.
 */
export function removeStoredLogins(folder: string | undefined): string[] {
  if (!folder) {
    return []
  }
  let names: string[]
  try {
    names = fs.readdirSync(folder)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names.filter((file) => CREDENTIALS_FILE.test(file))) {
    try {
      fs.rmSync(path.join(folder, name), { force: true })
      removed.push(name)
    } catch {
      // Best effort: an uninstall cannot report anything.
    }
  }
  return removed
}

if (require.main === module) {
  removeStoredLogins(cliConfigFolder(process.env.TMC_LANGS_CONFIG_DIR ?? TMC_LANGS_CONFIG_DIR))
}
