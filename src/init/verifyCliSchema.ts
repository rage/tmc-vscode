import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"

import type * as vscode from "vscode"

import { EXTENSION_VERSION } from "../config/constants"
import { Logger } from "../utilities"

// The vendored schema ships with the extension, so a match holds until either side changes.
const VERIFIED_SCHEMA_KEY = "cli-schema-verified-for"

/**
 * Startup self-check for the tmc-langs-cli output contract.
 *
 * Runs `tmc-langs-cli schema` and byte-compares it against the vendored
 * `shared/bindings.schema.json` (the same file the generated zod schemas in
 * `shared/langsSchema.ts` are checked against). A mismatch means the CLI
 * binary and the extension were built against different contract versions,
 * which would otherwise only surface later as opaque JSON validation
 * failures. A match is remembered in `memento` for this CLI file and extension
 * version, which skips the check until one of them changes.
 *
 * Diagnostic only: never throws; a mismatch is reported via `Logger.warn`
 * instead of failing activation.
 */
export async function verifyCliSchema(
  cliPath: string,
  extensionPath: string,
  memento: vscode.Memento,
): Promise<void> {
  try {
    const cliFile = await fs.promises.stat(cliPath)
    const verifiedFor = `${EXTENSION_VERSION} ${cliPath} ${cliFile.size} ${cliFile.mtimeMs}`
    if (memento.get(VERIFIED_SCHEMA_KEY) === verifiedFor) {
      return
    }
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
      await memento.update(VERIFIED_SCHEMA_KEY, verifiedFor)
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
    Logger.warn(
      "Failed to check the tmc-langs-cli output schema against the bundled contract schema.",
      error,
    )
  }
}
