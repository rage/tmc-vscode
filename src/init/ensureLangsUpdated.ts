import { createHash, randomUUID } from "crypto"
import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type Dialog from "../api/dialog"
import { FileSystemError, InitializationError } from "../errors"
import { downloadFile, getLangsCLIForPlatform, getPlatform, Logger, sleep } from "../utilities"

/** Extra attempts after the first, for the one download too large to redo cheaply. */
const DOWNLOAD_RETRIES = 2
const RETRY_BACKOFF_MS = 500

/**
 * Parses the hash out of a `.sha256` file's contents and normalizes it to
 * lowercase so comparisons are case-insensitive. Accepts both the canonical
 * "HASH  filename" form and a bare hash with no filename, and also tolerates
 * uppercase hex, CRLF, tabs and leading whitespace (it splits on any run of
 * whitespace). An empty or whitespace-only file yields "".
 */
export function parseSha256Sum(contents: string): string {
  return contents.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
}

/**
 * Hashes the CLI at `cliPath` and compares it against the checksum stored in the
 * `.sha256` file at `shaPath`. Used both for the initial check and for
 * re-verification after a redownload.
 *
 * The checksum is served by the same origin as the binary, so a match proves the
 * download is intact, not that it is the build we published: this detects
 * corruption and truncation, never substitution.
 *
 * The CLI is hashed as a stream so a large binary is never read fully into
 * memory and the hashing doesn't block the event loop in one burst during
 * activation. A missing or unreadable CLI/checksum file is reported as a
 * non-match (this never throws) so the caller can redownload instead of
 * crashing activation.
 */
export async function verifyCli(
  cliPath: string,
  shaPath: string,
): Promise<{ match: boolean; cliDigest: string; hashData: string }> {
  let cliDigest = ""
  try {
    cliDigest = await hashFile(cliPath)
  } catch (error) {
    Logger.warn(`Failed to read or hash CLI at ${cliPath} for verification:`, error)
  }

  let hashData = ""
  try {
    hashData = parseSha256Sum(await fs.readFile(shaPath, "utf-8"))
  } catch (error) {
    Logger.warn(`Failed to read checksum file at ${shaPath} for verification:`, error)
  }

  // An empty cliDigest means the CLI couldn't be hashed; require a non-empty
  // digest so two unreadable files don't compare equal ("" === "").
  const match = cliDigest !== "" && cliDigest === hashData
  return { match, cliDigest, hashData }
}

/**
 * Streams the file at `filePath` through a SHA-256 hash and resolves with the
 * digest as lowercase hex. Rejects if the file cannot be read.
 */
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

/**
 * Deletes what earlier installs left in the CLI folder: other versions, and downloads abandoned
 * long enough ago that no install still writes them. Never throws; an entry that cannot be
 * removed, such as a CLI another window is running, is logged and left.
 *
 * @param keep The entries to leave, by file name.
 */
export async function removeStaleCliFiles(cliFolder: string, keep: string[]): Promise<void> {
  const entries = await fs.readdir(cliFolder).catch(() => [])
  for (const entry of entries.filter((x) => !keep.includes(x))) {
    const entryPath = path.join(cliFolder, entry)
    try {
      if (isDownloadTempFile(entry)) {
        const { mtimeMs } = await fs.stat(entryPath)
        if (Date.now() - mtimeMs < ABANDONED_DOWNLOAD_AGE_MS) {
          continue
        }
      }
      await fs.rm(entryPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (error) {
      Logger.warn(`Failed to remove ${entryPath} from the CLI folder`, error)
    }
  }
}

/**
 * Downloads correct langs version for the current extension version, unless already present. Will
 * remove any previous versions once it has.
 *
 * @param cliFolder
 * @param dialog
 * @param config Download URL and version to fetch; owned by the caller (the
 * extension passes the build-inlined constants, tests pass a local server).
 */
async function ensureLangsUpdated(
  cliFolder: string,
  dialog: Dialog,
  config: { downloadUrl: string; version: string },
): Promise<Result<string, Error>> {
  const { downloadUrl, version } = config

  Logger.info("Platform " + process.platform + " Arch " + process.arch)
  const platform = getPlatform()
  if (platform === "unsupported") {
    return Err(
      new InitializationError(`No tmc-langs-cli build for ${process.platform}/${process.arch}`),
    )
  }
  const executable = getLangsCLIForPlatform(platform, version)
  Logger.info("TMC-Langs version: " + executable)

  // download CLI if necessary
  const cliPath = path.join(cliFolder, executable)
  const shaPath = cliPath + ".sha256"
  const cliUrl = downloadUrl + executable
  const shaUrl = cliUrl + ".sha256"
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
  }

  // check shasum
  const initial = await verifyCli(cliPath, shaPath)
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
        new InitializationError(
          result.val,
          `Mismatch found between ${checksumMismatchDetails(initial, cliPath, cliUrl, shaPath, shaUrl)}, failed during retry`,
        ),
      )
    }

    // Re-verify after the redownload so we never hand back a binary that does
    // not match its checksum; a persistent mismatch is fatal.
    const recheck = await verifyCli(cliPath, shaPath)
    if (!recheck.match) {
      return Err(
        new InitializationError(
          `Checksum still mismatched after redownload between ${checksumMismatchDetails(recheck, cliPath, cliUrl, shaPath, shaUrl)}`,
        ),
      )
    }
  }

  return Ok(cliPath)
}

/**
 * Builds the shared "CLI (...) and checksum (...)" detail string used in the
 * redownload-failure and persistent-mismatch error messages.
 */
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
    return langsDownloadResult
  }
  try {
    const fd = await fs.open(tempPath, "r+")
    await fs.fchmod(fd, 0o755)
    await fs.close(fd)
  } catch (e) {
    // not sure what the best way to handle errors here is
    // this may be a good compromise between allowing expert users to take care of it themselves
    // vs. allowing new users to easily just try again in case it was a fluke
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
    return Err(shaResult.val)
  }
  const checksumInstalled = await moveIntoPlace(shaTempPath, shaPath)
  if (checksumInstalled.ok) {
    await removeStaleCliFiles(cliFolder, [path.basename(cliPath), path.basename(shaPath)])
  }
  return checksumInstalled
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
    if (await fs.pathExists(target)) {
      Logger.warn(`Using the ${target} another install put in place`, error)
      return Ok.EMPTY
    }
    return Err(new FileSystemError(error, `Failed to move ${tempPath} to ${target}`))
  }
}

export { ensureLangsUpdated }
