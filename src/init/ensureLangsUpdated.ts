import * as path from "path"

import { Sha256 } from "@aws-crypto/sha256-js"
import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type Dialog from "../api/dialog"
import { FileSystemError, InitializationError } from "../errors"
import { downloadFile, getLangsCLIForPlatform, getPlatform, Logger, sleep } from "../utilities"

/** Extra attempts after the first, for the one download too large to redo cheaply. */
const DOWNLOAD_RETRIES = 2
const RETRY_BACKOFF_MS = 500

/** Global-state key holding the CLI a previous run checksummed successfully. */
export const VERIFIED_CLI_KEY = "tmc-langs-verified-cli"

/**
 * Identifies the exact file a checksum verdict was reached about. Hashing 51 MB
 * of CLI costs most of a second, so a run that finds all four fields unchanged
 * skips it; any redownload or hand-edit changes the size or the mtime and the
 * hash runs again.
 */
interface VerifiedCli {
  version: string
  cliPath: string
  size: number
  mtimeMs: number
}

/** Describes the CLI on disk now, or `undefined` if it is not readable. */
async function describeCli(cliPath: string, version: string): Promise<VerifiedCli | undefined> {
  const stats = await fs.stat(cliPath).catch(() => undefined)
  if (!stats) {
    return undefined
  }
  return { version, cliPath, size: stats.size, mtimeMs: stats.mtimeMs }
}

function isSameCli(remembered: VerifiedCli | undefined, current: VerifiedCli): boolean {
  return (
    remembered !== undefined &&
    remembered.version === current.version &&
    remembered.cliPath === current.cliPath &&
    remembered.size === current.size &&
    remembered.mtimeMs === current.mtimeMs
  )
}

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
    const hash = new Sha256()
    const stream = fs.createReadStream(filePath)
    stream.on("error", reject)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(Buffer.from(hash.digestSync()).toString("hex")))
  })
}

/**
 * Removes the CLI folder, tolerating a missing folder and retrying on transient
 * Windows ENOTEMPTY/EBUSY failures. Returns an Err Result instead of throwing so
 * a failed delete can never crash activation.
 */
export async function removeCliFolder(cliFolder: string): Promise<Result<void, Error>> {
  try {
    await fs.rm(cliFolder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    return Ok.EMPTY
  } catch (error) {
    return Err(new FileSystemError(error, `Failed to remove CLI folder ${cliFolder}`))
  }
}

/**
 * Downloads correct langs version for the current extension version, unless already present. Will
 * remove any previous versions in the process.
 *
 * @param cliFolder
 * @param dialog
 * @param config Download URL and version to fetch; owned by the caller (the
 * extension passes the build-inlined constants, tests pass a local server).
 * @param memento Where the checksum verdict is remembered between runs, so an
 * unchanged CLI is not rehashed on every activation.
 */
async function ensureLangsUpdated(
  cliFolder: string,
  dialog: Dialog,
  config: { downloadUrl: string; version: string },
  memento: vscode.Memento,
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

  const onDisk = await describeCli(cliPath, version)
  if (onDisk && isSameCli(memento.get<VerifiedCli>(VERIFIED_CLI_KEY), onDisk)) {
    return Ok(cliPath)
  }

  // check shasum
  const initial = await verifyCli(cliPath, shaPath)
  if (!initial.match) {
    Logger.error("Mismatch between CLI and checksum, trying redownload")
    Logger.debug(`CLI "${initial.cliDigest}", hash "${initial.hashData}"`)
    // downloadLangs() clears the CLI folder before redownloading, so no
    // separate delete is needed here.
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

  const verified = await describeCli(cliPath, version)
  if (verified) {
    await memento.update(VERIFIED_CLI_KEY, verified)
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
  const removeResult = await removeCliFolder(cliFolder)
  if (removeResult.err) {
    Logger.error("Failed to clear existing CLI folder before download:", removeResult.val)
    return removeResult
  }

  // copy to temp file and rename to prevent partial downloads from causing issues
  const tempPath = path.join(cliFolder, `temp-${executable}`)

  Logger.info(`Downloading TMC-langs from ${cliUrl} to temporary file ${tempPath}`)
  const message = `Downloading TMC-langs ${version}...`
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
    // Typing change from update
    return Err(e as Error)
  }
  await fs.rename(tempPath, cliPath)

  // Same temp-then-rename as the binary: a checksum file that exists is complete.
  const shaTempPath = shaPath + ".tmp"
  const shaResult = await downloadFile(shaUrl, shaTempPath)
  if (shaResult.err) {
    Logger.error("An error occurred while downloading the checksum for TMC-langs:", shaResult.val)
    return Err(shaResult.val)
  }
  await fs.rename(shaTempPath, shaPath)

  return Ok.EMPTY
}

export { ensureLangsUpdated }
