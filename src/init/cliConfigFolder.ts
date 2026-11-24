import * as os from "os"
import * as path from "path"

import { CLIENT_NAME } from "../config/constants"

/** The CLI's credential files: legacy `credentials.json` and the per-host `credentials_mooc_<host>.json`. */
export const CREDENTIALS_FILE = /^credentials(_mooc(_.+)?)?\.json$/

/**
 * The folder `tmc-langs-cli` keeps its settings and logins in, or `undefined` where it has none.
 *
 * `configuredDir` is what `Langs` passes as `TMC_LANGS_CONFIG_DIR`; without it this mirrors the
 * CLI's own fallback, `get_tmc_dir` in tmc-langs' `config.rs` on the `dirs` crate's `config_dir`.
 */
export function cliConfigFolder(
  configuredDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string | undefined {
  let base: string | undefined
  if (configuredDir) {
    base = configuredDir
  } else if (platform === "win32") {
    base = env.APPDATA
  } else if (platform === "darwin") {
    base = path.join(home, "Library", "Application Support")
  } else {
    const xdg = env.XDG_CONFIG_HOME
    base = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".config")
  }
  return base && path.join(base, `tmc-${CLIENT_NAME}`)
}
