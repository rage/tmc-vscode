import Dialog from "../api/dialog";
import { TMC_LANGS_DL_URL, TMC_LANGS_VERSION } from "../config/constants";
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
 * `.sha256` file at `shaPath`. Synchronous; used both for the initial check and
 * for re-verification after a redownload.
 */
export function verifyCli(
    cliPath: string,
    shaPath: string,
): { match: boolean; cliDigest: string; hashData: string } {
    const cliHash = new Sha256();
    cliHash.update(fs.readFileSync(cliPath));
    // windows returns the calculated hash in uppercase for some reason...
    const cliDigest = Buffer.from(cliHash.digestSync()).toString("hex").toLowerCase();
    const hashData = parseSha256Sum(fs.readFileSync(shaPath, "utf-8"));
    return { match: cliDigest === hashData, cliDigest, hashData };
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
 * @param opts Optional overrides (used by tests); defaults to the webpack-inlined constants.
 */
async function ensureLangsUpdated(
    cliFolder: string,
    dialog: Dialog,
    opts?: { downloadUrl?: string; version?: string },
): Promise<Result<string, Error>> {
    const downloadUrl = opts?.downloadUrl ?? TMC_LANGS_DL_URL;
    const version = opts?.version ?? TMC_LANGS_VERSION;

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
    const initial = verifyCli(cliPath, shaPath);
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
                    `Mismatch found between CLI (${initial.cliDigest} ${cliPath} from ${cliUrl}) and checksum (${initial.hashData} ${shaPath} from ${shaUrl}), failed during retry`,
                ),
            );
        }

        // Re-verify after the redownload so we never hand back an unverified
        // binary; a persistent mismatch is fatal.
        const recheck = verifyCli(cliPath, shaPath);
        if (!recheck.match) {
            return Err(
                new InitializationError(
                    `Checksum still mismatched after redownload between CLI (${recheck.cliDigest} ${cliPath} from ${cliUrl}) and checksum (${recheck.hashData} ${shaPath} from ${shaUrl})`,
                ),
            );
        }
    }

    return Ok(cliPath);
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
