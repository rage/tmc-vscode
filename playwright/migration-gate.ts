import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join, resolve } from "node:path"

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

function cliVersion(): string | undefined {
  const cliDir = resolve(__dirname, "..", "backend", "cli")
  try {
    const binary = readdirSync(cliDir).find(
      (name) => name.startsWith("tmc-langs-cli-") && !name.endsWith(".sha256"),
    )
    if (!binary) {
      return undefined
    }
    return execFileSync(join(cliDir, binary), ["--version"], { encoding: "utf-8" })
  } catch {
    return undefined
  }
}

const version = cliVersion()
const cmp =
  version === undefined ? undefined : semVerCompare(version, MOOC_CONTRACT_VERSION, "patch")
const cliSupportsMoocContract = cmp !== undefined && cmp >= 0

if (!cliSupportsMoocContract) {
  console.warn(
    `Skipping the mooc e2e specs: backend/cli reports ${version?.trim() ?? "no version"}, ` +
      `which does not implement the mooc CLI contract (needs >= ${MOOC_CONTRACT_VERSION}). ` +
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
