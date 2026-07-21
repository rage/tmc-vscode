import { zstdCompressSync } from "zlib"

import { TarArchive } from "archiver"

// Builds the exercise stub archives the mooc download path serves.
//
// The courses.mooc.fi langs client (tmc-mooc-client) downloads an exercise's
// stub from the editor task public spec's `stub_download_url` and extracts it
// with Compression::TarZstd -- i.e. a zstd-compressed tar, NOT the .zip the
// legacy TMC mock serves. Node 24's zlib has native zstd (zstdCompressSync),
// so we build a plain tar with `archiver` and zstd-compress the bytes.
//
// The archive lays the exercise project files out at the archive root (no
// top-level directory), matching how the TMC mock's ZipArchive is built with
// `directory(dir, false)`; tmc-langs' extract_project detects the python
// project from the root-level src/ + test/ + .tmcproject.yml layout.

const cache = new Map<string, Buffer>()

const buildTar = async (sourceDir: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const archive = new TarArchive()
    const chunks: Buffer[] = []
    archive.on("data", (chunk: Buffer) => chunks.push(chunk))
    archive.on("error", reject)
    archive.on("end", () => resolve(Buffer.concat(chunks)))
    // `false` => omit the base directory name, so files sit at the archive root
    archive.directory(sourceDir, false)
    void archive.finalize()
  })

/**
 * Builds (and memoises) a `.tar.zst` archive of the given exercise project
 * directory, returning the compressed bytes ready to serve as the response
 * body of a `stub_download_url`.
 */
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
