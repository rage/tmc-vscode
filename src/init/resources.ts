import { sync as delSync } from "del";
import * as fs from "fs-extra";
import * as path from "path";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import {
    EXTENSION_ID,
    TMC_LANGS_RUST_DL_URL,
    WORKSPACE_ROOT_FILE,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_SETTINGS,
} from "../config/constants";
import Resources from "../config/resources";
import Storage from "../config/storage";
import { downloadFile, getPlatform, getRustExecutable } from "../utils/";
import { Logger } from "../utils/logger";
import { showProgressNotification } from "../window";

/**
 * Checks if Java is present and performs resource initialization on extension activation
 * @param extensionContext Extension context
 */
export async function resourceInitialization(
    extensionContext: vscode.ExtensionContext,
    storage: Storage,
): Promise<Result<Resources, Error>> {
    const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version;

    const cssPath = extensionContext.asAbsolutePath("resources/styles");
    const htmlPath = extensionContext.asAbsolutePath("resources/templates");
    const mediaPath = extensionContext.asAbsolutePath("media");

    const tmcDataPath =
        storage.getExtensionSettings()?.dataPath ||
        path.join(extensionContext.globalStoragePath, "tmcdata");

    // Remove in 2.0.0 from here
    const javaDownloadPath = path.join(tmcDataPath, "java");
    const javaDownloadPathTemp = path.join(tmcDataPath, "javaTemp");
    delSync(path.join(javaDownloadPathTemp), { force: true });

    if (fs.existsSync(javaDownloadPath)) {
        delSync(javaDownloadPath.split(path.sep).join("/"), { force: true });
    }
    // Remove in 2.0.0 to here

    const tmcWorkspacePathRelative = "TMC workspace";
    const tmcExercisesFolderPathRelative = path.join("TMC workspace", "Exercises");

    if (!fs.existsSync(tmcDataPath)) {
        fs.mkdirSync(tmcDataPath, { recursive: true });
        Logger.log(`Created tmc data directory at ${tmcDataPath}`);
    }

    const tmcWorkspacePath = path.join(tmcDataPath, tmcWorkspacePathRelative);
    if (!fs.existsSync(tmcWorkspacePath)) {
        fs.mkdirSync(tmcWorkspacePath);
        Logger.log(`Created tmc workspace directory at ${tmcWorkspacePath}`);
    }

    const tmcExercisesFolderPath = path.join(tmcDataPath, tmcExercisesFolderPathRelative);
    if (!fs.existsSync(tmcExercisesFolderPath)) {
        fs.mkdirSync(tmcExercisesFolderPath);
        Logger.log(`Created tmc exercise directory at ${tmcExercisesFolderPath}`);
    }

    if (!fs.existsSync(path.join(tmcExercisesFolderPath, WORKSPACE_ROOT_FILE))) {
        fs.writeFileSync(
            path.join(tmcExercisesFolderPath, WORKSPACE_ROOT_FILE),
            WORKSPACE_ROOT_FILE_TEXT,
        );
        Logger.log(`Wrote tmc root file at ${tmcExercisesFolderPath}`);
    }

    // Remove in 2.0.0
    delSync(path.join(tmcDataPath, "*.jar"), { force: true });

    // Verify that all course .code-workspaces are in-place on startup.
    const userData = storage.getUserData();
    userData?.courses.forEach((course) => {
        const tmcWorkspaceFilePath = path.join(
            tmcDataPath,
            tmcWorkspacePathRelative,
            course.name + ".code-workspace",
        );
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS));
            Logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    });

    /**
     * Insider version toggle.
     */
    const platform = getPlatform();
    Logger.log("Detected platform " + platform);
    Logger.log("Platform " + process.platform + " Arch " + process.arch);
    const executable = getRustExecutable(platform);
    Logger.log("Executable " + executable);
    const cliPath = path.join(tmcDataPath, "cli", executable);
    const cliUrl = TMC_LANGS_RUST_DL_URL + executable;
    if (!fs.existsSync(cliPath)) {
        delSync(path.join(tmcDataPath, "cli"), { force: true });
        Logger.log("Downloading CLI from", cliUrl, "to", cliPath);
        const [tmcLangsRustCLI] = await showProgressNotification(
            "Downloading required files...",
            async (p) =>
                await downloadFile(
                    cliUrl,
                    cliPath,
                    undefined,
                    undefined,
                    (_progress: number, increment: number) => p.report({ increment }),
                ),
        );
        if (tmcLangsRustCLI.err) {
            Logger.warn("Occured some error while downloading TMC Langs rust", tmcLangsRustCLI);
        }
        try {
            const fd = await fs.open(cliPath, "r+");
            await fs.fchmod(fd, 0o111);
            await fs.close(fd);
        } catch (e) {
            Logger.error("Error changing permissions for CLI", e);
        }
        Logger.log("CLI at", cliPath);
    }

    const resources: Resources = new Resources(
        cssPath,
        extensionVersion,
        htmlPath,
        mediaPath,
        tmcDataPath,
        tmcWorkspacePathRelative,
        tmcExercisesFolderPathRelative,
        cliPath,
    );

    return new Ok(resources);
}
