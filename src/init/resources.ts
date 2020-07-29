import { sync as delSync } from "del";
import * as fs from "fs-extra";
import * as glob from "glob";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as unzipper from "unzipper";
import * as vscode from "vscode";

import { showProgressNotification } from "../api/vscode";
import {
    EXTENSION_ID,
    JAVA_ZIP_URLS,
    TMC_JAR_NAME,
    TMC_JAR_URL,
    TMC_LANGS_RUST_DL_URL,
    WORKSPACE_ROOT_FILE,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_SETTINGS,
} from "../config/constants";
import Resources from "../config/resources";
import Storage from "../config/storage";
import { downloadFile, getPlatform, getRustExecutable, isJavaPresent } from "../utils/";
import { Logger } from "../utils/logger";

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

    let javaPath: string;
    const javaDownloadPath = path.join(tmcDataPath, "java");
    const javaDownloadPathTemp = path.join(tmcDataPath, "javaTemp");
    delSync(path.join(javaDownloadPathTemp), { force: true });

    if (await isJavaPresent()) {
        javaPath = "java";
        delSync(javaDownloadPath.split(path.sep).join("/"), { force: true });
    } else {
        fs.mkdirSync(javaDownloadPathTemp, { recursive: true });
        // Glob patterns should use / as separator on all platforms
        const javaBinaryGlob =
            javaDownloadPath.split(path.sep).join("/") +
            (getPlatform().startsWith("windows") ? "/**/java.exe" : "/**/java");
        let paths = glob.sync(javaBinaryGlob);

        if (paths.length === 0) {
            const archivePath = path.join(tmcDataPath, "java.zip");
            if (!fs.existsSync(archivePath)) {
                const javaUrl = Object.entries(JAVA_ZIP_URLS)
                    .filter((x) => x[0] === getPlatform())
                    .map((x) => x[1])
                    .pop();
                if (javaUrl === undefined) {
                    return new Err(new Error("Java not found or improperly configured."));
                }
                Logger.log(`Downloading java from ${javaUrl} to ${archivePath}`);
                await showProgressNotification(
                    "Java not found. Downloading standalone bundle...",
                    async (p) =>
                        downloadFile(
                            javaUrl,
                            archivePath,
                            undefined,
                            undefined,
                            (progress: number, increment: number) =>
                                p.report({
                                    increment,
                                }),
                        ),
                );
            }
            await showProgressNotification("Extracting Java...", async (p) => {
                const totalSize = fs.statSync(archivePath).size;
                return fs
                    .createReadStream(archivePath)
                    .addListener("data", (c) =>
                        p.report({ increment: (100 * c.length) / totalSize }),
                    )
                    .pipe(unzipper.Extract({ path: javaDownloadPathTemp }))
                    .promise();
            });
            delSync(javaDownloadPath, { force: true });
            fs.renameSync(javaDownloadPathTemp, javaDownloadPath);
            delSync(archivePath, { force: true });

            paths = glob.sync(javaBinaryGlob);
            if (paths.length === 0) {
                return new Err(new Error("Couldn't find Java binary after extraction"));
            }
        }
        javaPath = paths[0];
        fs.chmodSync(javaPath, "755");
    }

    const tmcWorkspacePathRelative = "TMC workspace";
    const tmcExercisesFolderPathRelative = path.join("TMC workspace", "Exercises");
    const tmcClosedExercisesFolderPathRelative = "closed-exercises";
    const tmcLangsPathRelative = TMC_JAR_NAME;

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

    const tmcClosedExercisesFolderPath = path.join(
        tmcDataPath,
        tmcClosedExercisesFolderPathRelative,
    );
    if (!fs.existsSync(tmcClosedExercisesFolderPath)) {
        fs.mkdirSync(tmcClosedExercisesFolderPath);
        Logger.log(`Created tmc closed exercise directory at ${tmcClosedExercisesFolderPath}`);
    }

    const tmcLangsPath = path.join(tmcDataPath, tmcLangsPathRelative);
    if (!fs.existsSync(tmcLangsPath)) {
        delSync(path.join(tmcDataPath, "*.jar"), { force: true });
        const [tmcLangsResult] = await showProgressNotification(
            "Downloading required files...",
            async (p) =>
                downloadFile(
                    TMC_JAR_URL,
                    tmcLangsPath,
                    undefined,
                    undefined,
                    (progress: number, increment: number) => p.report({ increment }),
                ),
        );

        if (tmcLangsResult.err) {
            return new Err(tmcLangsResult.val);
        }
        Logger.log(`${TMC_JAR_URL} downloaded`);
    }

    /**
     * Insider version toggle.
     */
    const platform = getPlatform();
    Logger.log("Detected platform", platform);
    Logger.log("Platform", process.platform, "Arch", process.arch);
    const executable = getRustExecutable(platform);
    Logger.log("Executable", executable);
    const cliPath = path.join(tmcDataPath, "cli", executable);
    const cliUrl = TMC_LANGS_RUST_DL_URL + executable;
    if (!fs.existsSync(cliPath)) {
        delSync(path.join(tmcDataPath, "cli", "tmc-langs-cli*"), { force: true });
        Logger.log("Downloading CLI from", cliUrl, "to", cliPath);
        const [tmcLangsRustCLI] = await showProgressNotification(
            "Downloading required files...",
            async (p) =>
                downloadFile(
                    cliUrl,
                    cliPath,
                    undefined,
                    undefined,
                    (progress: number, increment: number) => p.report({ increment }),
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
        tmcLangsPathRelative,
        tmcWorkspacePathRelative,
        tmcExercisesFolderPathRelative,
        tmcClosedExercisesFolderPathRelative,
        javaPath,
        cliPath,
    );

    return new Ok(resources);
}
