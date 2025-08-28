import Storage from "../api/storage";
import { EXTENSION_ID, WORKSPACE_ROOT_FILE_TEXT, WORKSPACE_SETTINGS } from "../config/constants";
import Resources from "../config/resources";
import { Logger } from "../utilities/logger";
import * as fs from "fs-extra";
import * as path from "path";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

/**
 * Performs resource initialization on extension activation
 * @param extensionContext Extension context
 */
export async function resourceInitialization(
    extensionContext: vscode.ExtensionContext,
    storage: Storage,
    tmcDataPath: string | undefined,
    workspaceFileFolder: string,
): Promise<Result<Resources, Error>> {
    const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version;

    const cssPath = extensionContext.asAbsolutePath("resources/styles");
    const htmlPath = extensionContext.asAbsolutePath("resources/templates");
    const mediaPath = extensionContext.asAbsolutePath("media");

    if (tmcDataPath) {
        if (!fs.existsSync(tmcDataPath)) {
            fs.mkdirSync(tmcDataPath, { recursive: true });
            Logger.info(`Created tmc data directory at ${tmcDataPath}`);
        }
    } else {
        Logger.warn("Skipped tmc data directory check");
    }

    const resources = new Resources(
        cssPath,
        extensionVersion,
        htmlPath,
        mediaPath,
        workspaceFileFolder,
        tmcDataPath,
    );

    // Verify that all course .code-workspaces are in-place on startup.
    fs.ensureDirSync(workspaceFileFolder);
    const userData = storage.getUserData();
    userData?.courses.forEach((course) => {
        const tmcWorkspaceFilePath = path.join(
            workspaceFileFolder,
            course.name + ".code-workspace",
        );
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS));
            Logger.info(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    });

    // Verify that .tmc folder and its contents exists
    fs.ensureDirSync(resources.workspaceRootFolder.fsPath);
    fs.writeFileSync(resources.workspaceRootFile.fsPath, WORKSPACE_ROOT_FILE_TEXT);

    return new Ok(resources);
}
