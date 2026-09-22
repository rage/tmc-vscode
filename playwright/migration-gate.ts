import { join, resolve } from "node:path"

import { MIGRATION_CONTRACT_VERSION, productionApi } from "../config"
import { probeCli } from "../src/test-integration/cliMigrationProbe"
import { getLangsCLIForPlatform, getPlatform } from "../src/utilities/env"
import { vsCodeTest } from "./fixtures"

// The mooc specs drive CLI subcommands (`mooc login`, `mooc courses`,
// `mooc list-local-course-exercises`, ...) that no released CLI has yet -- the
// pinned one only knows the pre-migration `mooc course-instance*` surface.
// `backend/cli` is what the mock backend serves to the extension: the released
// binary that `backend`'s setup downloads, or a migration-branch build
// installed under the same name by bin/useLocalLangs.bash. Mirrors the
// integration tier's `migrationTest` (src/test-integration/tmc_langs_cli.spec.ts).

// The pinned filename, not whatever the directory happens to hold: a stale
// binary left beside the current one would otherwise be picked at random.
const CLI_PATH = join(
  resolve(__dirname, "..", "backend", "cli"),
  getLangsCLIForPlatform(getPlatform(), productionApi.__TMC_LANGS_VERSION__.replaceAll('"', "")),
)

const probe = probeCli(CLI_PATH, MIGRATION_CONTRACT_VERSION)
if (probe.kind === "broken") {
  throw new Error(`Could not read a version from the tmc-langs CLI at ${CLI_PATH}: ${probe.cause}`)
}

const cliSupportsMoocContract = probe.kind === "version" && probe.meetsMinimum

if (!cliSupportsMoocContract) {
  const reason =
    probe.kind === "absent"
      ? `no CLI at ${CLI_PATH} (run \`pnpm --dir backend run setup\`)`
      : `backend/cli reports ${probe.version}, which does not implement the mooc CLI contract`
  console.warn(
    `Skipping the mooc e2e specs: ${reason} (needs >= ${MIGRATION_CONTRACT_VERSION}). ` +
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
