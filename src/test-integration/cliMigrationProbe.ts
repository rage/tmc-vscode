import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

import { semVerCompare } from "../utilities/semanticVersion"

/**
 * What a `tmc-langs-cli` binary at a given path reports about itself, checked
 * against the minimum version a caller needs. Shared by the integration
 * (`tmc_langs_cli.spec.ts`) and Playwright (`playwright/migration-gate.ts`)
 * migration gates so a broken binary is classified identically by both.
 *
 * `broken` -- present but unrunnable, or printing no parseable version -- is
 * deliberately distinct from `absent`: treating a broken binary as merely too
 * old would let it skip silently, which is how a suite stays green while
 * testing nothing.
 */
export type CliProbe =
  | { kind: "version"; version: string; meetsMinimum: boolean }
  | { kind: "absent" }
  | { kind: "broken"; cause: string }

/**
 * Runs `<cliPath> --version` and classifies the result against `minVersion`
 * (compared at patch granularity). Never throws; a caller that wants
 * `broken` to fail the run does so itself.
 */
export function probeCli(cliPath: string, minVersion: string): CliProbe {
  if (!existsSync(cliPath)) {
    return { kind: "absent" }
  }
  let reported: string
  try {
    reported = execFileSync(cliPath, ["--version"], { encoding: "utf-8" }).trim()
  } catch (error) {
    return { kind: "broken", cause: String(error) }
  }
  // `--version` prints `tmc-langs-cli <version>`, so the version is embedded in
  // the line rather than being the whole of it; semVerCompare matches unanchored.
  const comparison = semVerCompare(reported, minVersion, "patch")
  if (comparison === undefined) {
    return { kind: "broken", cause: `\`--version\` printed ${JSON.stringify(reported)}` }
  }
  return { kind: "version", version: reported, meetsMinimum: comparison >= 0 }
}
