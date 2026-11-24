import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"

import {
  CLIENT_NAME,
  EXTENSION_VERSION,
  MOOC_BACKEND_URL,
  TMC_BACKEND_URL,
  TMC_LANGS_CONFIG_DIR,
} from "./config/constants"
import { CREDENTIALS_FILE, cliConfigFolder } from "./init/cliConfigFolder"

/**
 * The file, beside the bundled scripts of the installed extension, holding the path of the CLI
 * the extension last ran: only the extension host can work it out.
 */
const CLI_PATH_RECORD = "cli-path"

/** Long enough to revoke a login over a slow network; an uninstall must not hang on it. */
const LOGOUT_TIMEOUT_MS = 15_000

/**
 * Logs out of courses.mooc.fi with the CLI at `cliPath`, which also revokes the login on the
 * server, then removes the logins left on disk, so the next person to install TestMyCode on a
 * shared computer is not logged in as this one. Exercises stay. Run by VS Code's
 * `vscode:uninstall` hook, outside the extension host, so it cannot use the `vscode` API.
 *
 * @param configuredDir What `Langs` passes as `TMC_LANGS_CONFIG_DIR`, if anything.
 * @param cliPath The CLI to log out with first; the logins it leaves are deleted either way.
 * @returns The credential files deleted after the logout.
 */
export function removeStoredLogins(
  configuredDir: string | undefined,
  cliPath?: string | undefined,
): string[] {
  const folder = cliConfigFolder(configuredDir)
  if (cliPath && fs.existsSync(cliPath)) {
    cp.spawnSync(
      cliPath,
      ["mooc", "--client-name", CLIENT_NAME, "--client-version", EXTENSION_VERSION, "logout"],
      {
        cwd: path.dirname(cliPath),
        env: {
          ...process.env,
          TMC_LANGS_TMC_ROOT_URL: process.env.TMC_LANGS_TMC_ROOT_URL ?? TMC_BACKEND_URL,
          TMC_LANGS_MOOC_ROOT_URL: process.env.TMC_LANGS_MOOC_ROOT_URL ?? MOOC_BACKEND_URL,
          ...(configuredDir ? { TMC_LANGS_CONFIG_DIR: configuredDir } : {}),
        },
        stdio: "ignore",
        timeout: LOGOUT_TIMEOUT_MS,
        windowsHide: true,
      },
    )
  }
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

/** The CLI {@link recordCliPath} recorded, if it did. */
function recordedCliPath(): string | undefined {
  try {
    return fs.readFileSync(path.join(__dirname, CLI_PATH_RECORD), "utf-8").trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Records `cliPath` for {@link removeStoredLogins} to log out with on uninstall. Best effort: an
 * extension folder that cannot be written leaves the uninstall deleting the logins only.
 */
export async function recordCliPath(cliPath: string): Promise<void> {
  if (recordedCliPath() === cliPath) {
    return
  }
  await fs.promises.writeFile(path.join(__dirname, CLI_PATH_RECORD), cliPath).catch(() => undefined)
}

if (require.main === module) {
  removeStoredLogins(process.env.TMC_LANGS_CONFIG_DIR ?? TMC_LANGS_CONFIG_DIR, recordedCliPath())
}
