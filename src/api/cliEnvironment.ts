import { MOOC_BACKEND_URL, TMC_BACKEND_URL, TRUST_DEV_MOOC_HOST } from "../config/constants"
import { proxyEnvironment } from "./proxyEnvironment"

/**
 * The environment every tmc-langs-cli run gets: the backends, the config dir and VS Code's
 * proxy settings, with the process's own variables winning where tests set them. Free of the
 * `vscode` API, as the uninstall hook uses it too.
 *
 * @param configDir Passed as `TMC_LANGS_CONFIG_DIR`, over any the environment has.
 */
export function cliEnvironment(
  configDir: string | undefined,
  httpProxy: { proxy: string; noProxy: string[] } | undefined,
): NodeJS.ProcessEnv {
  return {
    ...proxyEnvironment(httpProxy, process.env),
    ...process.env,
    TMC_LANGS_TMC_ROOT_URL: process.env.TMC_LANGS_TMC_ROOT_URL ?? TMC_BACKEND_URL,
    TMC_LANGS_MOOC_ROOT_URL: process.env.TMC_LANGS_MOOC_ROOT_URL ?? MOOC_BACKEND_URL,
    ...(configDir ? { TMC_LANGS_CONFIG_DIR: configDir } : {}),
    ...(TRUST_DEV_MOOC_HOST ? { TMC_LANGS_MOOC_TRUST_LOCALHOST: "1" } : {}),
  }
}
