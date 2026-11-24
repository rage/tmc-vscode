import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"

import { cliEnvironment } from "./api/cliEnvironment"
import { CLIENT_NAME, EXTENSION_VERSION, TMC_LANGS_CONFIG_DIR } from "./config/constants"
import { CREDENTIALS_FILE, cliConfigFolder } from "./init/cliConfigFolder"

/**
 * The file, beside the bundled scripts of the installed extension, holding a {@link CliRecord}:
 * only the extension host can work it out.
 */
const CLI_RECORD = "cli-record.json"

/** How the extension last ran the CLI: its path and VS Code's proxy settings. */
export interface CliRecord {
  cliPath: string
  httpProxy?: { proxy: string; noProxy: string[] } | undefined
}

/** A per-host courses.mooc.fi login, which the CLI's logout removes for this computer only. */
const PER_HOST_LOGIN = /^credentials_mooc_.+\.json$/

/** Long enough to revoke a login over a slow network; an uninstall must not hang on it. */
const LOGOUT_TIMEOUT_MS = 15_000

/**
 * Logs out of courses.mooc.fi with the CLI at `cliPath`, which also revokes the login on the
 * server, then removes the logins left on disk, so the next person to install TestMyCode on a
 * shared computer is not logged in as this one. Exercises stay. Run by VS Code's
 * `vscode:uninstall` hook, outside the extension host, so it cannot use the `vscode` API.
 *
 * @param configuredDir What `Langs` passes as `TMC_LANGS_CONFIG_DIR`, if anything.
 * @param cli The CLI to log out with first. After its logout, other computers' logins in a
 * shared home folder stay; without it, every stored login is deleted.
 * @returns The credential files deleted after the logout.
 */
export function removeStoredLogins(
  configuredDir: string | undefined,
  cli?: CliRecord | undefined,
): string[] {
  const folder = cliConfigFolder(configuredDir)
  const cliPath = cli?.cliPath
  let isLoggedOut = false
  if (cliPath && fs.existsSync(cliPath)) {
    const logout = cp.spawnSync(
      cliPath,
      ["mooc", "--client-name", CLIENT_NAME, "--client-version", EXTENSION_VERSION, "logout"],
      {
        cwd: path.dirname(cliPath),
        env: cliEnvironment(configuredDir, cli.httpProxy),
        stdio: "ignore",
        timeout: LOGOUT_TIMEOUT_MS,
        windowsHide: true,
      },
    )
    isLoggedOut = logout.status === 0
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
  const isRemoved = (file: string): boolean =>
    CREDENTIALS_FILE.test(file) && !(isLoggedOut && PER_HOST_LOGIN.test(file))
  for (const name of names.filter((file) => isRemoved(file))) {
    try {
      fs.rmSync(path.join(folder, name), { force: true })
      removed.push(name)
    } catch {
      // Best effort: an uninstall cannot report anything.
    }
  }
  return removed
}

/** The CLI {@link recordCli} recorded, if it did. */
function recordedCli(): CliRecord | undefined {
  try {
    const record: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, CLI_RECORD), "utf-8"))
    return typeof record === "object" &&
      record !== null &&
      typeof (record as CliRecord).cliPath === "string"
      ? (record as CliRecord)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Records how to run the CLI for {@link removeStoredLogins} to log out with on uninstall. Best
 * effort: an extension folder that cannot be written leaves the uninstall deleting the logins only.
 */
export async function recordCli(record: CliRecord): Promise<void> {
  const file = path.join(__dirname, CLI_RECORD)
  const serialized = JSON.stringify(record)
  if ((await fs.promises.readFile(file, "utf-8").catch(() => undefined)) === serialized) {
    return
  }
  await fs.promises.writeFile(file, serialized).catch(() => undefined)
}

if (require.main === module) {
  removeStoredLogins(process.env.TMC_LANGS_CONFIG_DIR ?? TMC_LANGS_CONFIG_DIR, recordedCli())
}
