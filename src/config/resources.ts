import * as path from "path";

export default class Resources {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly mediaFolder: string;
    public readonly extensionVersion: string;
    private readonly _tmcWorkspaceFolderPathRelative: string;
    private readonly _tmcExercisesFolderPathRelative: string;
    private _tmcDataFolder: string;
    private _cliPath: string;

    constructor(
        cssFolder: string,
        extensionVersion: string,
        htmlFolder: string,
        mediaFolder: string,
        tmcDataFolder: string,
        tmcWorkspaceFolderPathRelative: string,
        tmcExercisesFolderPathRelative: string,
        cliPath: string,
    ) {
        this.cssFolder = cssFolder;
        this.extensionVersion = extensionVersion;
        this.htmlFolder = htmlFolder;
        this.mediaFolder = mediaFolder;
        this._tmcDataFolder = tmcDataFolder;
        this._tmcWorkspaceFolderPathRelative = tmcWorkspaceFolderPathRelative;
        this._tmcExercisesFolderPathRelative = tmcExercisesFolderPathRelative;
        this._cliPath = cliPath;
    }

    public setDataPath(dataPath: string): void {
        this._tmcDataFolder = dataPath;
    }

    public getCliPath(): string {
        return this._cliPath;
    }

    public setCliPath(cliPath: string): void {
        this._cliPath = cliPath;
    }

    public getWorkspaceFolderPath(): string {
        return path.join(this._tmcDataFolder, this._tmcWorkspaceFolderPathRelative);
    }

    public getWorkspaceFilePath(courseName: string): string {
        return path.join(
            this._tmcDataFolder,
            this._tmcWorkspaceFolderPathRelative,
            courseName + ".code-workspace",
        );
    }

    public getExercisesFolderPath(): string {
        return path.join(this._tmcDataFolder, this._tmcExercisesFolderPathRelative);
    }

    public getDataPath(): string {
        return this._tmcDataFolder;
    }
}
