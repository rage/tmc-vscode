import * as cp from "child_process"
import * as fs from "fs"
import * as path from "path"

import type * as vscode from "vscode"

import { EXTENSION_VERSION } from "../config/constants"
import { Logger } from "../utilities"

// The vendored schema ships with the extension, so a match holds until either side changes.
const VERIFIED_SCHEMA_KEY = "cli-schema-verified-for"

/**
 * Startup self-check that the CLI's output contract matches the extension's: byte-compares
 * `tmc-langs-cli schema` with the vendored `shared/bindings.schema.json`, so a version
 * mismatch is reported up front rather than as opaque JSON validation failures later.
 * A match is remembered in `memento` per CLI file and extension version.
 *
 * Diagnostic only: never throws; a mismatch goes to `Logger.warn`, not activation failure.
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
