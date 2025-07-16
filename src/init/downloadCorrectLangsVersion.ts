import { deleteSync } from "del";
import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";

import Dialog from "../api/dialog";
import { TMC_LANGS_DL_URL, TMC_LANGS_VERSION } from "../config/constants";
import { downloadFile, getLangsCLIForPlatform, getPlatform, Logger } from "../utilities";
import { Sha256 } from "@aws-crypto/sha256-js";

/**
 * Downloads correct langs version for the current extension version, unless already present. Will
 * remove any previous versions in the process.
 *
 * @param cliFolder
 */
async function downloadCorrectLangsVersion(
    cliFolder: string,
    dialog: Dialog,
): Promise<Result<string, Error>> {
    Logger.info("Platform " + process.platform + " Arch " + process.arch);
    const executable = getLangsCLIForPlatform(getPlatform(), TMC_LANGS_VERSION);
    Logger.info("TMC-Langs version: " + executable);

    // download CLI if necessary
    const cliPath = path.join(cliFolder, executable);
    const shaPath = cliPath + ".sha256";
    const cliUrl = TMC_LANGS_DL_URL + executable;
    const shaUrl = cliUrl + ".sha256";
    if (!fs.existsSync(cliPath)) {
        deleteSync(cliFolder, { force: true });

        // copy to temp file and rename to prevent partial downloads from causing issues
        const tempPath = path.join(cliFolder, `temp-${executable}`);

        Logger.info(`Downloading TMC-langs from ${cliUrl} to temporary file ${tempPath}`);
        const message = `Downloading TMC-langs ${TMC_LANGS_VERSION}...`;
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
    }

    // download shasum if necessary
    if (!fs.existsSync(shaPath)) {
        const result = await downloadFile(shaUrl, shaPath);
        if (result.err) {
            Logger.error(
                "An error occurred while downloading the checksum for TMC-langs:",
                result.val,
            );
        }
    }

    // check shasum
    const cliHash = new Sha256();
    const cliData = fs.readFileSync(cliPath);
    cliHash.update(cliData);
    const cliDigest = Buffer.from(cliHash.digestSync()).toString("hex");

    const hashData = fs.readFileSync(shaPath, "utf-8").split(" ")[0];
    if (cliDigest !== hashData) {
        Logger.error("Mismatch between CLI and checksum, please try again");
        deleteSync(cliFolder, { force: true });
        return Err(new Error("Mismatch between CLI and checksum, please try again"));
    }

    return Ok(cliPath);
}

export { downloadCorrectLangsVersion };
