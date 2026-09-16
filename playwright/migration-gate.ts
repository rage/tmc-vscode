import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { productionApi } from "../config"
import { getLangsCLIForPlatform, getPlatform } from "../src/utilities/env"
import { semVerCompare } from "../src/utilities/semanticVersion"
import { vsCodeTest } from "./fixtures"

// The mooc specs drive CLI subcommands (`mooc login`, `mooc courses`,
// `mooc list-local-course-exercises`, ...) that no released CLI has yet -- the
// pinned one only knows the pre-migration `mooc course-instance*` surface.
// `backend/cli` is what the mock backend serves to the extension: the released
// binary that `backend`'s setup downloads, or a migration-branch build
// installed under the same name by bin/useLocalLangs.bash. Mirrors the
// integration tier's `migrationTest` (src/test-integration/tmc_langs_cli.spec.ts).
//
// Anchored to the first release that will carry the contract rather than to
// whatever is pinned today, so bumping TMC_LANGS_RUST_VERSION for an unrelated
// fix cannot silently switch these on.
const MOOC_CONTRACT_VERSION = "0.40.0"

// The pinned filename, not whatever the directory happens to hold: a stale
// binary left beside the current one would otherwise be picked at random.
const CLI_PATH = join(
  resolve(__dirname, "..", "backend", "cli"),
  getLangsCLIForPlatform(getPlatform(), productionApi.__TMC_LANGS_VERSION__.replaceAll('"', "")),
)

/**
 * What the tmc-langs CLI under `backend/cli` reports about itself.
 *
 * `broken` -- present but unrunnable, or printing no version -- is deliberately
 * distinct from `absent`: skipping on it would report a broken harness as "the
 * pinned CLI is too old", which is how a suite stays green while testing
 * nothing.
 */
type CliProbe =
  | { kind: "version"; version: string; carriesMoocContract: boolean }
  | { kind: "absent" }
  | { kind: "broken"; cause: string }

function probeCli(): CliProbe {
  if (!existsSync(CLI_PATH)) {
    return { kind: "absent" }
  }
  let reported: string
  try {
    reported = execFileSync(CLI_PATH, ["--version"], { encoding: "utf-8" }).trim()
  } catch (error) {
    return { kind: "broken", cause: String(error) }
  }
  // `--version` prints `tmc-langs-cli <version>`, so the version is embedded in
  // the line rather than being the whole of it; semVerCompare matches unanchored.
  const comparison = semVerCompare(reported, MOOC_CONTRACT_VERSION, "patch")
  if (comparison === undefined) {
    return { kind: "broken", cause: `\`--version\` printed ${JSON.stringify(reported)}` }
  }
  return { kind: "version", version: reported, carriesMoocContract: comparison >= 0 }
}

const probe = probeCli()
if (probe.kind === "broken") {
  throw new Error(`Could not read a version from the tmc-langs CLI at ${CLI_PATH}: ${probe.cause}`)
}

const cliSupportsMoocContract = probe.kind === "version" && probe.carriesMoocContract

if (!cliSupportsMoocContract) {
  const reason =
    probe.kind === "absent"
      ? `no CLI at ${CLI_PATH} (run \`pnpm --dir backend run setup\`)`
      : `backend/cli reports ${probe.version}, which does not implement the mooc CLI contract`
  console.warn(
    `Skipping the mooc e2e specs: ${reason} (needs >= ${MOOC_CONTRACT_VERSION}). ` +
      "Install a migration-branch build with bin/useLocalLangs.bash to run them.",
  )
}

/**
 * Use in place of `vsCodeTest` for specs that need the mooc CLI contract: runs
 * against a migration-branch build, skips (with the reason logged above)
 * against the released CLI. Delete this module and its call sites once
 * TMC_LANGS_RUST_VERSION points at a release that carries the mooc contract.
 */
export const migrationTest = cliSupportsMoocContract ? vsCodeTest : vsCodeTest.skip
