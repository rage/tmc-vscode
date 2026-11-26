import { createRequire } from "node:module"

import checksums from "../../config/langsChecksums.json"
import { getAllLangsCLIs } from "../../utilities/env"

type Profile = Record<string, string>
const { mockBackend, mockTmcLocalMooc, productionApi } = createRequire(import.meta.url)(
  "../../../config.js",
) as Record<"mockBackend" | "mockTmcLocalMooc" | "productionApi", Profile>

suite("the built-in langs checksums", function () {
  const pinnedVersion = JSON.parse(productionApi.__TMC_LANGS_VERSION__ as string) as string

  test("are for the pinned release; run `pnpm run vendor:langs-checksums` after bumping it", function () {
    expect(checksums.version).toBe(pinnedVersion)
  })

  test("cover every platform build of the pinned release with a SHA-256", function () {
    const table: Record<string, string> = checksums.sha256
    const executables = getAllLangsCLIs(pinnedVersion)
    for (const executable of executables) {
      expect(table[executable], `no checksum for ${executable}`).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(Object.keys(table).toSorted()).toEqual(executables.toSorted())
  })

  test("are what the production build embeds, and only that profile enforces them", function () {
    expect(JSON.parse(productionApi.__TMC_LANGS_CHECKSUMS__ as string)).toEqual(checksums.sha256)
    expect(mockBackend.__TMC_LANGS_CHECKSUMS__).toBe("null")
    expect(mockTmcLocalMooc.__TMC_LANGS_CHECKSUMS__).toBe("null")
  })
})
