import * as fs from "fs-extra";
import * as path from "path";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import {
    EXTENSION_ID,
    WORKSPACE_ROOT_FILE,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_SETTINGS,
} from "../config/constants";
import Resources from "../config/resources";
import Storage from "../config/storage";
import { Logger } from "../utils/logger";

/**
 * Performs resource initialization on extension activation
 * @param extensionContext Extension context
 */
export async function resourceInitialization(
    extensionContext: vscode.ExtensionContext,
    storage: Storage,
    tmcDataPath: string,
): Promise<Result<Resources, Error>> {
    const extensionVersion = vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON.version;

    const cssPath = extensionContext.asAbsolutePath("resources/styles");
    const htmlPath = extensionContext.asAbsolutePath("resources/templates");
    const mediaPath = extensionContext.asAbsolutePath("media");

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

    const resources = new Resources(
        cssPath,
        extensionVersion,
        htmlPath,
        mediaPath,
        tmcDataPath,
        tmcWorkspacePathRelative,
        tmcExercisesFolderPathRelative,
    );

    return new Ok(resources);
}
