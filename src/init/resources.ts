import * as fs from "fs-extra";
import * as path from "path";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import Storage from "../api/storage";
import { EXTENSION_ID, WORKSPACE_SETTINGS } from "../config/constants";
import Resources from "../config/resources";
import { Logger } from "../utils/logger";

/**
 * Performs resource initialization on extension activation
 * @param extensionContext Extension context
 */
export async function resourceInitialization(
    extensionContext: vscode.ExtensionContext,
    storage: Storage,
    tmcDataPath: string,
    workspaceFileFolder: string,
): Promise<Result<Resources, Error>> {
    const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version;

    const cssPath = extensionContext.asAbsolutePath("resources/styles");
    const htmlPath = extensionContext.asAbsolutePath("resources/templates");
    const mediaPath = extensionContext.asAbsolutePath("media");

    if (!fs.existsSync(tmcDataPath)) {
        fs.mkdirSync(tmcDataPath, { recursive: true });
        Logger.log(`Created tmc data directory at ${tmcDataPath}`);
    }

    // Verify that all course .code-workspaces are in-place on startup.
    const userData = storage.getUserData();
    userData?.courses.forEach((course) => {
        const tmcWorkspaceFilePath = path.join(tmcDataPath, course.name + ".code-workspace");
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS));
            Logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    });

    const resources = new Resources(
        cssPath,
        extensionVersion,
        htmlPath,
        mediaPath,
        workspaceFileFolder,
        tmcDataPath,
    );

    return new Ok(resources);
}
