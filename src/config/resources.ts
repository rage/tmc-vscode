import * as path from "path";
import * as vscode from "vscode";

export default class Resources {
    private _projectsDirectory: string;

    constructor(
        readonly cssFolder: string,
        readonly extensionVersion: string,
        readonly htmlFolder: string,
        readonly mediaFolder: string,
        readonly workspaceFileFolder: string,
        projectsDirectory: string,
    ) {
        this._projectsDirectory = projectsDirectory;
    }

    get projectsDirectory(): string {
        return this._projectsDirectory;
    }

    set projectsDirectory(directory: string) {
        this._projectsDirectory = directory;
    }

    get workspaceRootFolder(): vscode.Uri {
        return vscode.Uri.file(path.join(this.workspaceFileFolder, ".tmc"));
    }

    public getWorkspaceFilePath(courseName: string): string {
        return path.join(this.workspaceFileFolder, courseName + ".code-workspace");
    }
}
