// Records the SHA-256 of every tmc-langs-cli build of the release config.js pins, from the
// release's own .sha256 files, in src/config/langsChecksums.json. The production build embeds
// the table, so a download is judged against it and not only against a checksum served beside
// the binary. Needs network (download.mooc.fi).
//
//   (no flag)  fetch and write the table
//   --check    fetch and fail if the table differs from the release
//
// Run via `pnpm run vendor:langs-checksums`.
import { readFileSync, writeFileSync } from "node:fs"

import { productionApi } from "../config"
import { getAllLangsCLIs } from "../src/utilities/env"

const TABLE_PATH = "src/config/langsChecksums.json"
const downloadUrl = JSON.parse(productionApi.__TMC_LANGS_DL_URL__) as string
const version = JSON.parse(productionApi.__TMC_LANGS_VERSION__) as string

async function fetchTable(): Promise<{ version: string; sha256: Record<string, string> }> {
  const sha256: Record<string, string> = {}
  for (const executable of getAllLangsCLIs(version)) {
    const url = `${downloadUrl}${executable}.sha256`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`${url}: ${response.status} ${response.statusText}`)
    }
    const digest = (await response.text()).trim().split(/\s+/)[0]?.toLowerCase() ?? ""
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`${url}: not a SHA-256 digest`)
    }
    sha256[executable] = digest
  }
  return { version, sha256 }
}

async function main(): Promise<void> {
  const fetched = `${JSON.stringify(await fetchTable(), null, 2)}\n`
  if (process.argv.includes("--check")) {
    if (readFileSync(TABLE_PATH, "utf8") !== fetched) {
      console.error(
        `${TABLE_PATH} does not match the ${version} release. Run: pnpm run vendor:langs-checksums`,
      )
      process.exit(1)
    }
    console.log(`${TABLE_PATH} matches the ${version} release.`)
    return
  }
  writeFileSync(TABLE_PATH, fetched)
  console.log(`Wrote ${TABLE_PATH} for ${version}.`)
}

// oxlint-disable-next-line unicorn/prefer-top-level-await -- tsx runs this as CJS (no "type": "module")
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
