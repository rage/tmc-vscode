import { deleteSync } from "del";
import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";

import Dialog from "../api/dialog";
import { TMC_LANGS_DL_URL, TMC_LANGS_VERSION } from "../config/constants";
import { downloadFile, getLangsCLIForPlatform, getPlatform, Logger } from "../utilities";

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

    const cliPath = path.join(cliFolder, executable);
    if (fs.existsSync(cliPath)) {
        return Ok(cliPath);
    }

    deleteSync(cliFolder, { force: true });

    // copy to temp file and rename to prevent partial downloads from causing issues
    const tempPath = path.join(cliFolder, `temp-${executable}`);

    const cliUrl = TMC_LANGS_DL_URL + executable;
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
        await fs.fchmod(fd, 0o111);
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

    return Ok(cliPath);
}

export { downloadCorrectLangsVersion };
