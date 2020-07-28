import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { WORKSPACE_ROOT_FILE, WORKSPACE_ROOT_FILE_TEXT } from "../config/constants";
import Resources from "../config/resources";
import { Logger } from "../utils/logger";

/**
 * Used to watch that the TMC-Readme.md file exists in TMC Workspace/".tmc" path.
 */
export default class WorkspaceWatcher {
    private readonly resources: Resources;
    private watcher: vscode.FileSystemWatcher;

    constructor(resources: Resources) {
        this.resources = resources;
        this.watcher = vscode.workspace.createFileSystemWatcher(
            this.resources.getWorkspaceFolderPath() + "/**",
            true,
            false,
            false,
        );
    }

    public start(): void {
        this.verifyWorkspaceRootFile();
        this.watcher.onDidDelete((x) => {
            if (x.fsPath.includes(".tmc")) {
                this.fileDeleteAction(x.fsPath);
            }
        });
        this.watcher.onDidChange((x) => {
            if (x.fsPath.includes(".tmc")) {
                this.fileChangeAction(x.fsPath);
            }
        });
    }

    /**
     * Verifies that .tmc/ file exists and it's contents is correct.
     */
    public verifyWorkspaceRootFile(): void {
        const rootFileFolder = path.join(this.resources.getWorkspaceFolderPath(), ".tmc");
        const pathToRootFile = path.join(rootFileFolder, WORKSPACE_ROOT_FILE);
        if (!fs.existsSync(pathToRootFile)) {
            Logger.log(`Creating ${pathToRootFile}`);
            fs.mkdirSync(rootFileFolder, { recursive: true });
            fs.writeFileSync(pathToRootFile, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
        } else if (
            fs.readFileSync(pathToRootFile, { encoding: "utf-8" }) !== WORKSPACE_ROOT_FILE_TEXT
        ) {
            Logger.log(`Rewriting ${WORKSPACE_ROOT_FILE_TEXT} at ${pathToRootFile}`);
            fs.writeFileSync(pathToRootFile, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
        }
    }

    private fileDeleteAction(targetPath: string): void {
        const basedir = this.resources.getWorkspaceFolderPath();
        const rootFilePath = path.join(basedir, ".tmc", WORKSPACE_ROOT_FILE);

        if (path.relative(rootFilePath, targetPath) === "") {
            Logger.log(`Root file deleted ${targetPath}, fixing issue.`);
            if (!fs.existsSync(path.join(basedir, ".tmc"))) {
                fs.mkdirSync(path.join(basedir, ".tmc"), { recursive: true });
            }
            fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            return;
        }
    }

    private fileChangeAction(targetPath: string): void {
        const rootFilePath = path.join(
            this.resources.getWorkspaceFolderPath(),
            ".tmc",
            WORKSPACE_ROOT_FILE,
        );

        if (path.relative(rootFilePath, targetPath) === "") {
            if (fs.readFileSync(rootFilePath, { encoding: "utf-8" }) !== WORKSPACE_ROOT_FILE_TEXT) {
                Logger.log(`Rewriting ${WORKSPACE_ROOT_FILE_TEXT} at ${targetPath}`);
                fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            }
        }
    }
}
