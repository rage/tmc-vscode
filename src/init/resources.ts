import * as fs from "fs-extra";
import * as glob from "glob";
import * as path from "path";
import * as vscode from "vscode";
import * as unzipper from "unzipper";

import { Err, Ok, Result } from "ts-results";
import Resources from "../config/resources";
import { downloadFile, getPlatform, isJavaPresent } from "../utils/";
import {
    EXTENSION_ID,
    JAVA_ZIP_URLS,
    TMC_JAR_NAME,
    TMC_JAR_URL,
    WORKSPACE_ROOT_FILE,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_SETTINGS_EXCLUDE_META,
} from "../config/constants";
import Storage from "../config/storage";
import del = require("del");
import Logger from "../utils/logger";

/**
 * Checks if Java is present and performs resource initialization on extension activation
 * @param extensionContext Extension context
 */
export async function resourceInitialization(
    extensionContext: vscode.ExtensionContext,
    storage: Storage,
    logger: Logger,
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
    del.sync(path.join(javaDownloadPathTemp), { force: true });

    if (await isJavaPresent()) {
        javaPath = "java";
        del.sync(javaDownloadPath.split(path.sep).join("/"), { force: true });
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
                logger.log(`Downloading java from ${javaUrl} to ${archivePath}`);
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "TestMyCode",
                    },
                    async (p) =>
                        downloadFile(
                            javaUrl,
                            archivePath,
                            undefined,
                            undefined,
                            (progress: number, increment: number) =>
                                p.report({
                                    message: `Java not found. Downloading... (${progress}%)`,
                                    increment,
                                }),
                        ),
                );
            }
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "TestMyCode",
                },
                async (p) => {
                    const totalSize = fs.statSync(archivePath).size;
                    let totalExtracted = 0;
                    return fs
                        .createReadStream(archivePath)
                        .addListener("data", (c) => {
                            totalExtracted += c.length;
                            p.report({
                                message: `Extracting Java... (${Math.round(
                                    (100 * totalExtracted) / totalSize,
                                )}%)`,
                                increment: (100 * c.length) / totalSize,
                            });
                        })
                        .pipe(unzipper.Extract({ path: javaDownloadPathTemp }))
                        .promise();
                },
            );
            del.sync(javaDownloadPath, { force: true });
            fs.renameSync(javaDownloadPathTemp, javaDownloadPath);
            del.sync(archivePath, { force: true });

            paths = glob.sync(javaBinaryGlob);
            if (paths.length === 0) {
                return new Err(new Error("Couldn't find Java binary after extraction"));
            }
        }
        javaPath = paths[0];
        fs.chmodSync(javaPath, "755");
    }

    const tmcWorkspacePathRelative = "TMC workspace";
    const tmcWorkspaceFilePathRelative = path.join("TMC workspace", "TMC Exercises.code-workspace");
    const tmcExercisesFolderPathRelative = path.join("TMC workspace", "Exercises");
    const tmcClosedExercisesFolderPathRelative = "closed-exercises";
    const tmcLangsPathRelative = TMC_JAR_NAME;

    if (!fs.existsSync(tmcDataPath)) {
        fs.mkdirSync(tmcDataPath, { recursive: true });
        logger.log(`Created tmc data directory at ${tmcDataPath}`);
    }

    const tmcWorkspacePath = path.join(tmcDataPath, tmcWorkspacePathRelative);
    if (!fs.existsSync(tmcWorkspacePath)) {
        fs.mkdirSync(tmcWorkspacePath);
        logger.log(`Created tmc workspace directory at ${tmcWorkspacePath}`);
    }

    const tmcWorkspaceFilePath = path.join(tmcDataPath, tmcWorkspaceFilePathRelative);
    if (!fs.existsSync(tmcWorkspaceFilePath)) {
        fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS_EXCLUDE_META));
        logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
    }

    const tmcExercisesFolderPath = path.join(tmcDataPath, tmcExercisesFolderPathRelative);
    if (!fs.existsSync(tmcExercisesFolderPath)) {
        fs.mkdirSync(tmcExercisesFolderPath);
        logger.log(`Created tmc exercise directory at ${tmcExercisesFolderPath}`);
    }

    if (!fs.existsSync(path.join(tmcExercisesFolderPath, WORKSPACE_ROOT_FILE))) {
        fs.writeFileSync(
            path.join(tmcExercisesFolderPath, WORKSPACE_ROOT_FILE),
            WORKSPACE_ROOT_FILE_TEXT,
        );
        logger.log(`Wrote tmc root file at ${tmcExercisesFolderPath}`);
    }

    const tmcClosedExercisesFolderPath = path.join(
        tmcDataPath,
        tmcClosedExercisesFolderPathRelative,
    );
    if (!fs.existsSync(tmcClosedExercisesFolderPath)) {
        fs.mkdirSync(tmcClosedExercisesFolderPath);
        logger.log(`Created tmc closed exercise directory at ${tmcClosedExercisesFolderPath}`);
    }

    const tmcLangsPath = path.join(tmcDataPath, tmcLangsPathRelative);
    if (!fs.existsSync(tmcLangsPath)) {
        del.sync(path.join(tmcDataPath, "*.jar"), { force: true });
        const tmcLangsResult = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "TestMyCode",
            },
            async (p) =>
                downloadFile(
                    TMC_JAR_URL,
                    tmcLangsPath,
                    undefined,
                    undefined,
                    (progress: number, increment: number) =>
                        p.report({
                            message: `Downloading required files... (${progress}%)`,
                            increment,
                        }),
                ),
        );

        if (tmcLangsResult.err) {
            return new Err(tmcLangsResult.val);
        }
        logger.log(`${TMC_JAR_URL} downloaded`);
    }

    const resources: Resources = new Resources(
        storage,
        cssPath,
        extensionVersion,
        htmlPath,
        mediaPath,
        tmcDataPath,
        tmcLangsPathRelative,
        tmcWorkspacePathRelative,
        tmcWorkspaceFilePathRelative,
        tmcExercisesFolderPathRelative,
        tmcClosedExercisesFolderPathRelative,
        javaPath,
    );

    return new Ok(resources);
}
