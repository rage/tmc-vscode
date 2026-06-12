import Dialog from "../api/dialog";
import { FileSystemError, InitializationError } from "../errors";
import { downloadFile, getLangsCLIForPlatform, getPlatform, Logger } from "../utilities";
import { Sha256 } from "@aws-crypto/sha256-js";
import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";

/**
 * Parses the hash out of a `.sha256` file's contents and normalizes it to
 * lowercase so comparisons are case-insensitive. Accepts both the canonical
 * "HASH  filename" form and a bare hash with no filename, and also tolerates
 * uppercase hex, CRLF, tabs and leading whitespace (it splits on any run of
 * whitespace). An empty or whitespace-only file yields "".
 */
export function parseSha256Sum(contents: string): string {
    return contents.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/**
 * Hashes the CLI at `cliPath` and compares it against the checksum stored in the
 * `.sha256` file at `shaPath`. Used both for the initial check and for
 * re-verification after a redownload.
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
    let cliDigest = "";
    try {
        cliDigest = await hashFile(cliPath);
    } catch (error) {
        Logger.warn(`Failed to read or hash CLI at ${cliPath} for verification:`, error);
    }

    let hashData = "";
    try {
        hashData = parseSha256Sum(await fs.readFile(shaPath, "utf-8"));
    } catch (error) {
        Logger.warn(`Failed to read checksum file at ${shaPath} for verification:`, error);
    }

    // An empty cliDigest means the CLI couldn't be hashed; require a non-empty
    // digest so two unreadable files don't compare equal ("" === "").
    const match = cliDigest !== "" && cliDigest === hashData;
    return { match, cliDigest, hashData };
}

/**
 * Streams the file at `filePath` through a SHA-256 hash and resolves with the
 * digest as lowercase hex. Rejects if the file cannot be read.
 */
function hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = new Sha256();
        const stream = fs.createReadStream(filePath);
        stream.on("error", reject);
        stream.on("data", (chunk) => hash.update(chunk));
        // windows returns the calculated hash in uppercase for some reason...
        stream.on("end", () =>
            resolve(Buffer.from(hash.digestSync()).toString("hex").toLowerCase()),
        );
    });
}

/**
 * Removes the CLI folder, tolerating a missing folder and retrying on transient
 * Windows ENOTEMPTY/EBUSY failures. Returns an Err Result instead of throwing so
 * a failed delete can never crash activation.
 */
export async function removeCliFolder(cliFolder: string): Promise<Result<void, Error>> {
    try {
        await fs.rm(cliFolder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        return Ok.EMPTY;
    } catch (error) {
        return Err(new FileSystemError(error, `Failed to remove CLI folder ${cliFolder}`));
    }
}

/**
 * Downloads correct langs version for the current extension version, unless already present. Will
 * remove any previous versions in the process.
 *
 * @param cliFolder
 * @param dialog
 * @param config Download URL and version to fetch; owned by the caller (the
 * extension passes the webpack-inlined constants, tests pass a local server).
 */
async function ensureLangsUpdated(
    cliFolder: string,
    dialog: Dialog,
    config: { downloadUrl: string; version: string },
): Promise<Result<string, Error>> {
    const { downloadUrl, version } = config;

    Logger.info("Platform " + process.platform + " Arch " + process.arch);
    const executable = getLangsCLIForPlatform(getPlatform(), version);
    Logger.info("TMC-Langs version: " + executable);

    // download CLI if necessary
    const cliPath = path.join(cliFolder, executable);
    const shaPath = cliPath + ".sha256";
    const cliUrl = downloadUrl + executable;
    const shaUrl = cliUrl + ".sha256";
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
        );
        if (result.err) {
            return Err(result.val);
        }
    }

    // check shasum
    const initial = await verifyCli(cliPath, shaPath);
    if (!initial.match) {
        Logger.error("Mismatch between CLI and checksum, trying redownload");
        Logger.debug(`CLI "${initial.cliDigest}", hash "${initial.hashData}"`);
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
        );
        if (result.err) {
            return Err(
                new InitializationError(
                    result.val,
                    `Mismatch found between ${checksumMismatchDetails(initial, cliPath, cliUrl, shaPath, shaUrl)}, failed during retry`,
                ),
            );
        }

        // Re-verify after the redownload so we never hand back an unverified
        // binary; a persistent mismatch is fatal.
        const recheck = await verifyCli(cliPath, shaPath);
        if (!recheck.match) {
            return Err(
                new InitializationError(
                    `Checksum still mismatched after redownload between ${checksumMismatchDetails(recheck, cliPath, cliUrl, shaPath, shaUrl)}`,
                ),
            );
        }
    }

    return Ok(cliPath);
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
    );
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
    const removeResult = await removeCliFolder(cliFolder);
    if (removeResult.err) {
        Logger.error("Failed to clear existing CLI folder before download:", removeResult.val);
        return removeResult;
    }

    // copy to temp file and rename to prevent partial downloads from causing issues
    const tempPath = path.join(cliFolder, `temp-${executable}`);

    Logger.info(`Downloading TMC-langs from ${cliUrl} to temporary file ${tempPath}`);
    const message = `Downloading TMC-langs ${version}...`;
    const langsDownloadResult = await dialog.progressNotification(
        message,
        async (progress) =>
            await downloadFile(cliUrl, tempPath, undefined, (percent) => {
                // downloadFile gives both percent between 0-100 and discrete increment.
                // Divide here at least until deciding if "increments" are no longer necessary.
                progress.report({ message, percent: percent / 100 });
            }),
    );
    if (langsDownloadResult.err) {
        Logger.error("An error occurred while downloading TMC-langs:", langsDownloadResult.val);
        return langsDownloadResult;
    }
    try {
        const fd = await fs.open(tempPath, "r+");
        await fs.fchmod(fd, 0o755);
        await fs.close(fd);
    } catch (e) {
        // not sure what the best way to handle errors here is
        // this may be a good compromise between allowing expert users to take care of it themselves
        // vs. allowing new users to easily just try again in case it was a fluke
        Logger.error(
            `Error changing permissions for CLI at ${tempPath}. \
            You can try again or make it executable manually and remove the "temp-" prefix.`,
            e,
        );
        // Typing change from update
        return Err(e as Error);
    }
    await fs.rename(tempPath, cliPath);

    // download shasum if necessary
    if (!fs.existsSync(shaPath)) {
        const result = await downloadFile(shaUrl, shaPath);
        if (result.err) {
            Logger.error(
                "An error occurred while downloading the checksum for TMC-langs:",
                result.val,
            );
            return Err(result.val);
        }
    }
    return Ok.EMPTY;
}

export { ensureLangsUpdated };
