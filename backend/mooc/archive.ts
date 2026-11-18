import { zstdCompressSync } from "zlib"

import { TarArchive } from "archiver"

// tmc-mooc-client extracts an exercise's `stub_download_url` as a zstd-compressed tar
// (Compression::TarZstd), not the .zip the legacy TMC mock serves. Node 24's zlib has
// native zstd, so a plain `archiver` tar is zstd-compressed.
//
// Files sit at the archive root (no top-level directory): tmc-langs' extract_project
// detects a python project from the root-level src/, test/ and .tmcproject.yml.

const cache = new Map<string, Buffer>()

const buildTar = async (sourceDir: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const archive = new TarArchive()
    const chunks: Buffer[] = []
    archive.on("data", (chunk: Buffer) => chunks.push(chunk))
    archive.on("error", reject)
    archive.on("end", () => resolve(Buffer.concat(chunks)))
    archive.directory(sourceDir, false)
    void archive.finalize()
  })

/** Builds, and memoises per directory, the `.tar.zst` bytes to serve as a `stub_download_url`. */
export const buildTarZst = async (sourceDir: string): Promise<Buffer> => {
  const cached = cache.get(sourceDir)
  if (cached) {
    return cached
  }
  const tar = await buildTar(sourceDir)
  const compressed = zstdCompressSync(tar)
  cache.set(sourceDir, compressed)
  return compressed
}
