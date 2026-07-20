import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"

import { Logger } from "../utilities"

/**
 * Startup self-check for the tmc-langs-cli output contract.
 *
 * Runs `tmc-langs-cli schema` against the actual binary and byte-compares the
 * output with the vendored schema at `shared/bindings.schema.json` (the same
 * file the hand-written zod schemas in `shared/langsSchema.ts` are checked
 * against). A mismatch means the CLI binary and the extension were built
 * against different versions of the output contract, which would otherwise
 * only surface later as opaque JSON validation failures.
 *
 * This is a diagnostic only: it never throws, and a mismatch is reported with
 * `Logger.warn` instead of failing activation.
 */
export async function verifyCliSchema(cliPath: string, extensionPath: string): Promise<void> {
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
    // e.g. an older CLI without the `schema` subcommand, or a missing
    // vendored schema file; the check is best-effort by design
    Logger.warn(
      "Failed to check the tmc-langs-cli output schema against the bundled contract schema.",
      error,
    )
  }
}
