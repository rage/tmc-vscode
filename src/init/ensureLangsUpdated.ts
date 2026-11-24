import * as cp from "child_process"
import { createHash, randomUUID } from "crypto"
import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type Dialog from "../api/dialog"
import { CliVerificationError, FileSystemError, InitializationError } from "../errors"
import { downloadFile, getLangsCLIForPlatform, getPlatform, Logger, sleep } from "../utilities"

/** Extra attempts after the first, for the one download too large to redo cheaply. */
const DOWNLOAD_RETRIES = 2
const RETRY_BACKOFF_MS = 500

/**
 * The lowercase hash in a `.sha256` file's contents, from either "HASH  filename" or a bare hash.
 * Tolerates uppercase hex, CRLF and leading whitespace; an empty file yields "".
 */
export function parseSha256Sum(contents: string): string {
  return contents.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
}

/** Generous: a first run of a new binary can wait on an antivirus scan of it. */
const WARM_UP_TIMEOUT_MS = 60_000

/** What `verifyCli` last saw: when the file still has this size and mtime, its hash is not recomputed. */
interface VerifiedState {
  size: number
  mtimeMs: number
  sha256: string
}

function verifiedStatePath(cliPath: string): string {
  return `${cliPath}.verified`
}

async function readVerifiedDigest(cliPath: string): Promise<string | undefined> {
  try {
    const state = JSON.parse(
      await fs.readFile(verifiedStatePath(cliPath), "utf-8"),
    ) as VerifiedState
    const { size, mtimeMs } = await fs.stat(cliPath)
    return state.size === size && state.mtimeMs === mtimeMs ? state.sha256 : undefined
  } catch {
    return undefined
  }
}

async function writeVerifiedState(cliPath: string, sha256: string): Promise<void> {
  try {
    const { size, mtimeMs } = await fs.stat(cliPath)
    const state: VerifiedState = { size, mtimeMs, sha256 }
    await fs.writeFile(verifiedStatePath(cliPath), JSON.stringify(state))
  } catch (error) {
    Logger.warn(`Failed to record that ${cliPath} was verified`, error)
  }
}

/**
 * Whether the CLI at `cliPath` is the build we expect: its SHA-256 equals `expectedSha256` (the
 * table built into the extension), or, where the build has none, the `.sha256` file at `shaPath`.
 *
 * The `.sha256` file comes from the same origin as the binary, so matching it proves the download
 * is intact, not that it is the build we published; only `expectedSha256` does that.
 *
 * A file whose size and mtime are those of its last successful verification is not hashed again.
 *
 * Never throws: a missing or unreadable CLI or checksum file is a non-match, so the caller can
 * redownload instead of crashing activation.
 */
export async function verifyCli(
  cliPath: string,
  shaPath: string,
  expectedSha256?: string,
): Promise<{ match: boolean; cliDigest: string; hashData: string }> {
  let hashData = ""
  try {
    hashData = parseSha256Sum(await fs.readFile(shaPath, "utf-8"))
  } catch (error) {
    Logger.warn(`Failed to read checksum file at ${shaPath} for verification:`, error)
  }
  const wanted = expectedSha256 ?? hashData

  let cliDigest = (await readVerifiedDigest(cliPath)) ?? ""
  const isHashKnown = cliDigest !== ""
  if (!isHashKnown) {
    try {
      cliDigest = await hashFile(cliPath)
    } catch (error) {
      Logger.warn(`Failed to read or hash CLI at ${cliPath} for verification:`, error)
    }
  }

  // An empty digest means the file couldn't be hashed; two of them must not compare equal.
  const match = cliDigest !== "" && cliDigest === wanted
  if (match && !isHashKnown) {
    await writeVerifiedState(cliPath, cliDigest)
  }
  return { match, cliDigest, hashData: wanted }
}

/** The SHA-256 of the file at `filePath` as lowercase hex, streamed. Rejects if unreadable. */
function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = fs.createReadStream(filePath)
    stream.on("error", reject)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

/** How long a download's temp file goes unchanged before it counts as abandoned. */
const ABANDONED_DOWNLOAD_AGE_MS = 60 * 60 * 1000

/** Whether `entry` is a file a download writes before renaming it into place. */
function isDownloadTempFile(entry: string): boolean {
  return entry.startsWith("temp-") || entry.endsWith(".tmp")
}

/** The CLI executable a file in the CLI folder belongs to: itself, its checksum or its state. */
function executableOf(entry: string): string {
  return entry.replace(/\.(sha256|verified)$/, "")
}

/**
 * Deletes downloads abandoned long enough ago that no install still writes them. Never throws;
 * what cannot be removed is logged and left.
 */
async function removeAbandonedDownloads(cliFolder: string): Promise<void> {
  const entries = await fs.readdir(cliFolder).catch(() => [])
  for (const entry of entries.filter((name) => isDownloadTempFile(name))) {
    const entryPath = path.join(cliFolder, entry)
    try {
      const { mtimeMs } = await fs.stat(entryPath)
      if (Date.now() - mtimeMs >= ABANDONED_DOWNLOAD_AGE_MS) {
        await fs.rm(entryPath, { force: true, maxRetries: 5, retryDelay: 100 })
      }
    } catch (error) {
      Logger.warn(`Failed to remove ${entryPath} from the CLI folder`, error)
    }
  }
}

/**
 * Deletes what earlier installs left in the CLI folder: abandoned downloads and old versions,
 * except the most recently installed one. A window still running the previous extension version
 * spawns that one on every command. Never throws; an entry that cannot be removed, such as a CLI
 * another window is running, is logged and left.
 *
 * @param keep The entries to leave, by file name.
 */
export async function removeStaleCliFiles(cliFolder: string, keep: string[]): Promise<void> {
  await removeAbandonedDownloads(cliFolder)
  const entries = await fs.readdir(cliFolder).catch(() => [])
  const others = entries.filter((x) => !keep.includes(x) && !isDownloadTempFile(x))
  let previous: { executable: string; mtimeMs: number } | undefined
  for (const entry of others) {
    const executable = executableOf(entry)
    if (executable !== entry) {
      continue
    }
    const mtimeMs = await fs
      .stat(path.join(cliFolder, entry))
      .then((stats) => stats.mtimeMs)
      .catch(() => 0)
    if (!previous || mtimeMs > previous.mtimeMs) {
      previous = { executable, mtimeMs }
    }
  }
  for (const entry of others.filter((x) => executableOf(x) !== previous?.executable)) {
    const entryPath = path.join(cliFolder, entry)
    try {
      await fs.rm(entryPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (error) {
      Logger.warn(`Failed to remove ${entryPath} from the CLI folder`, error)
    }
  }
}

/** Runs the freshly installed CLI once so a first-run scan finishes before real commands start. */
async function warmUpCli(cliPath: string): Promise<void> {
  const startTime = Date.now()
  await new Promise<void>((resolve) => {
    const finish = (error: Error | null): void => {
      if (error) {
        Logger.warn("The warm-up run of the new TestMyCode tools failed:", error)
      } else {
        Logger.info(`Warm-up run of the new TestMyCode tools took ${Date.now() - startTime}ms`)
      }
      resolve()
    }
    try {
      cp.execFile(
        cliPath,
        ["--version"],
        { timeout: WARM_UP_TIMEOUT_MS, windowsHide: true },
        finish,
      )
    } catch (error) {
      // execFile throws synchronously for some spawn failures, such as ENOEXEC.
      finish(error as Error)
    }
  })
}

export interface LangsInstallConfig {
  /** Where the release's executables are served from. */
  downloadUrl: string
  version: string
  /**
   * SHA-256 of every executable of `version`, by file name. A download must match it, and a
   * file name missing from it fails the install. `null` where the served CLI is not a
   * release (dev and test profiles): the `.sha256` beside the download is then the only check.
   */
  builtInChecksums?: Record<string, string> | null | undefined
}

/**
 * Installs the langs version this extension pins unless already present and verified, then
 * removes old versions.
 *
 * @param config Owned by the caller (the extension passes the build-inlined constants and the
 * user's settings, tests pass a local server).
 */
async function ensureLangsUpdated(
  cliFolder: string,
  dialog: Dialog,
  config: LangsInstallConfig,
): Promise<Result<string, Error>> {
  const { downloadUrl, version, builtInChecksums } = config

  Logger.info("Platform " + process.platform + " Arch " + process.arch)
  const platform = getPlatform()
  if (platform === "unsupported") {
    return Err(
      new InitializationError(`No tmc-langs-cli build for ${process.platform}/${process.arch}`),
    )
  }
  const executable = getLangsCLIForPlatform(platform, version)
  Logger.info("TMC-Langs version: " + executable)

  const expectedSha256 = builtInChecksums?.[executable]
  if (builtInChecksums && expectedSha256 === undefined) {
    return Err(new InitializationError(`This extension has no built-in checksum for ${executable}`))
  }
  if (platform === "linuxmusl64") {
    void dialog.warningNotification(
      "This Linux uses musl instead of glibc, so the TestMyCode tools run without Java support: Java exercises cannot be run here.",
    )
  }

  await removeAbandonedDownloads(cliFolder)
  const cliPath = path.join(cliFolder, executable)
  const shaPath = cliPath + ".sha256"
  const cliUrl = downloadUrl + executable
  const shaUrl = cliUrl + ".sha256"
  let isInstalledNow = false
  if (!fs.existsSync(cliPath)) {
    const result = await downloadLangs(
      cliFolder,
      cliPath,
      cliUrl,
      shaPath,
      shaUrl,
      executable,
      version,
      dialog,
    )
    if (result.err) {
      return Err(result.val)
    }
    isInstalledNow = true
  }

  const initial = await verifyCli(cliPath, shaPath, expectedSha256)
  if (!initial.match) {
    Logger.error("Mismatch between CLI and checksum, trying redownload")
    Logger.debug(`CLI "${initial.cliDigest}", hash "${initial.hashData}"`)
    const result = await downloadLangs(
      cliFolder,
      cliPath,
      cliUrl,
      shaPath,
      shaUrl,
      executable,
      version,
      dialog,
    )
    if (result.err) {
      return Err(
        new CliVerificationError(
          cliPath,
          result.val,
          `Mismatch found between ${checksumMismatchDetails(initial, cliPath, cliUrl, shaPath, shaUrl)}, failed during retry`,
        ),
      )
    }
    isInstalledNow = true

    // A persistent mismatch is fatal: never hand back a binary that fails its checksum.
    const recheck = await verifyCli(cliPath, shaPath, expectedSha256)
    if (!recheck.match) {
      return Err(
        new InitializationError(
          `Checksum still mismatched after redownload between ${checksumMismatchDetails(recheck, cliPath, cliUrl, shaPath, shaUrl)}`,
        ),
      )
    }
  }

  if (isInstalledNow) {
    await warmUpCli(cliPath)
  }
  return Ok(cliPath)
}

/** The "CLI (...) and checksum (...)" detail of the redownload and mismatch errors. */
function checksumMismatchDetails(
  result: { cliDigest: string; hashData: string },
  cliPath: string,
  cliUrl: string,
  shaPath: string,
  shaUrl: string,
): string {
  return (
    `CLI (${result.cliDigest} ${cliPath} from ${cliUrl}) and ` +
    `checksum (${result.hashData} ${shaPath} from ${shaUrl})`
  )
}

async function downloadLangs(
  cliFolder: string,
  cliPath: string,
  cliUrl: string,
  shaPath: string,
  shaUrl: string,
  executable: string,
  version: string,
  dialog: Dialog,
): Promise<Result<void, Error>> {
  // A download goes to a temp file renamed into place, so a partial one is never run. The name
  // is this run's own: another window may be installing the same CLI into the same folder.
  const tempPath = path.join(cliFolder, `temp-${randomUUID()}-${executable}`)

  Logger.info(`Downloading TMC-langs from ${cliUrl} to temporary file ${tempPath}`)
  const message = `Downloading the TestMyCode tools (${version})…`
  const langsDownloadResult = await dialog.progressNotification(
    message,
    async (progress, token) => {
      const cancellation = new AbortController()
      const subscription = token.onCancellationRequested(() => cancellation.abort())
      const attempt = async (): Promise<Result<void, Error>> =>
        await downloadFile(cliUrl, tempPath, {
          signal: cancellation.signal,
          resume: true,
          onProgress: (percentDownloaded) =>
            progress.report({ message, fraction: percentDownloaded / 100 }),
        })
      try {
        let result = await attempt()
        for (let retry = 1; retry <= DOWNLOAD_RETRIES; retry++) {
          if (result.ok || token.isCancellationRequested) {
            break
          }
          Logger.warn("Download of TMC-langs failed, retrying in a moment:", result.val)
          await sleep(RETRY_BACKOFF_MS * retry)
          result = await attempt()
        }
        return result
      } finally {
        subscription.dispose()
      }
    },
    { cancellable: true },
  )
  if (langsDownloadResult.err) {
    Logger.error("An error occurred while downloading TMC-langs:", langsDownloadResult.val)
    await removeQuietly(tempPath)
    return langsDownloadResult
  }
  try {
    // Windows has no execute bit, and a scanner holding the new file there would fail this
    // without the back-off the rename below gets.
    if (process.platform !== "win32") {
      const fd = await fs.open(tempPath, "r+")
      try {
        await fs.fchmod(fd, 0o755)
      } finally {
        await fs.close(fd)
      }
    }
  } catch (e) {
    await removeQuietly(tempPath)
    // The message lets expert users fix it by hand while others just retry.
    Logger.error(
      `Error changing permissions for CLI at ${tempPath}. \
            You can try again or make it executable manually and remove the "temp-" prefix.`,
      e,
    )
    return Err(new FileSystemError(e, `Failed to make ${tempPath} executable`))
  }
  const installed = await moveIntoPlace(tempPath, cliPath)
  if (installed.err) {
    return installed
  }

  // Same temp-then-rename as the binary: a checksum file that exists is complete.
  const shaTempPath = `${shaPath}.${randomUUID()}.tmp`
  const shaResult = await downloadFile(shaUrl, shaTempPath)
  if (shaResult.err) {
    Logger.error("An error occurred while downloading the checksum for TMC-langs:", shaResult.val)
    await removeQuietly(shaTempPath)
    return Err(shaResult.val)
  }
  const checksumInstalled = await moveIntoPlace(shaTempPath, shaPath)
  if (checksumInstalled.ok) {
    await removeStaleCliFiles(cliFolder, [
      path.basename(cliPath),
      path.basename(shaPath),
      path.basename(verifiedStatePath(cliPath)),
    ])
  }
  return checksumInstalled
}

async function removeQuietly(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true, maxRetries: 5, retryDelay: 100 }).catch((error: unknown) => {
    Logger.warn(`Failed to remove ${filePath}`, error)
  })
}

/**
 * Renames a finished download to `target`. When that fails because another window got there
 * first, or on Windows is running the CLI already in place, whatever is at `target` is used and
 * the checksum check that follows decides whether it will do.
 */
async function moveIntoPlace(tempPath: string, target: string): Promise<Result<void, Error>> {
  try {
    await fs.rename(tempPath, target)
    return Ok.EMPTY
  } catch (error) {
    await removeQuietly(tempPath)
    if (await fs.pathExists(target)) {
      Logger.warn(`Using the ${target} another install put in place`, error)
      return Ok.EMPTY
    }
    return Err(new FileSystemError(error, `Failed to move ${tempPath} to ${target}`))
  }
}

export { ensureLangsUpdated }
