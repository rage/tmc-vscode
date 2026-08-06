import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"

import { TMC_LANGS_VERSION } from "../config/constants"
import { Logger, semVerCompare } from "../utilities"

// First tmc-langs-cli release with a `schema` subcommand. 0.39.4, the last
// release before it, only errors out on `schema`.
const SCHEMA_SUBCOMMAND_VERSION = "0.40.0"

/**
 * Startup self-check for the tmc-langs-cli output contract.
 *
 * Runs `tmc-langs-cli schema` and byte-compares it against the vendored
 * `shared/bindings.schema.json` (the same file the generated zod schemas in
 * `shared/langsSchema.ts` are checked against). A mismatch means the CLI
 * binary and the extension were built against different contract versions,
 * which would otherwise only surface later as opaque JSON validation
 * failures.
 *
 * Diagnostic only: never throws; a mismatch is reported via `Logger.warn`
 * instead of failing activation.
 *
 * Skipped for a pinned CLI older than {@link SCHEMA_SUBCOMMAND_VERSION}, which
 * has no `schema` subcommand: the check cannot run there, and warning about it
 * on every activation is noise the user can do nothing about.
 */
export async function verifyCliSchema(
  cliPath: string,
  extensionPath: string,
  cliVersion: string = TMC_LANGS_VERSION,
): Promise<void> {
  const comparison = semVerCompare(cliVersion, SCHEMA_SUBCOMMAND_VERSION, "patch")
  if (comparison === undefined || comparison < 0) {
    Logger.debug(
      `Skipping the tmc-langs-cli output schema check: ${cliVersion} predates the ` +
        `\`schema\` subcommand (added in ${SCHEMA_SUBCOMMAND_VERSION}).`,
    )
    return
  }
  try {
    const vendoredSchemaPath = path.join(extensionPath, "shared", "bindings.schema.json")
    const vendoredSchema = await fs.promises.readFile(vendoredSchemaPath, "utf8")
    const actualSchema = await new Promise<string>((resolve, reject) => {
      cp.execFile(
        cliPath,
        ["schema"],
        { maxBuffer: 16 * 1024 * 1024, timeout: 15_000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      )
    })
    if (actualSchema === vendoredSchema) {
      Logger.debug("tmc-langs-cli output schema matches the bundled contract schema.")
    } else {
      Logger.warn(
        "tmc-langs-cli output contract mismatch: the schema printed by " +
          `\`${path.basename(cliPath)} schema\` does not match the extension's ` +
          "bundled shared/bindings.schema.json. The CLI binary and the extension " +
          "were built against different versions of the output contract, so JSON " +
          "validation of CLI output may fail. Use a CLI build matching the bundled " +
          "schema, or re-vendor the schema with bin/updateLangsSchema.sh and update " +
          "shared/langsSchema.ts.",
      )
    }
  } catch (error) {
    // e.g. a missing vendored schema file, or a CLI installed under a pinned
    // filename that is older than it claims -- best-effort by design
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("unrecognized subcommand")) {
      Logger.debug(`The tmc-langs-cli at ${cliPath} has no \`schema\` subcommand; check skipped.`)
      return
    }
    Logger.warn(
      "Failed to check the tmc-langs-cli output schema against the bundled contract schema.",
      error,
    )
  }
}
