import * as path from "path";

export default class Resources {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly mediaFolder: string;
    public readonly extensionVersion: string;
    private readonly _tmcLangsPathRelative: string;
    private readonly _tmcWorkspaceFolderPathRelative: string;
    private readonly _tmcExercisesFolderPathRelative: string;
    private readonly _tmcClosedExercisesFolderPathRelative: string;
    private _tmcDataFolder: string;
    private _javaPath: string;
    private _cliPath: string;

    constructor(
        cssFolder: string,
        extensionVersion: string,
        htmlFolder: string,
        mediaFolder: string,
        tmcDataFolder: string,
        tmcLangsPathRelative: string,
        tmcWorkspaceFolderPathRelative: string,
        tmcExercisesFolderPathRelative: string,
        tmcClosedExercisesFolderPathRelative: string,
        javaPath: string,
        cliPath: string,
    ) {
        this.cssFolder = cssFolder;
        this.extensionVersion = extensionVersion;
        this.htmlFolder = htmlFolder;
        this.mediaFolder = mediaFolder;
        this._tmcDataFolder = tmcDataFolder;
        this._tmcLangsPathRelative = tmcLangsPathRelative;
        this._tmcWorkspaceFolderPathRelative = tmcWorkspaceFolderPathRelative;
        this._tmcExercisesFolderPathRelative = tmcExercisesFolderPathRelative;
        this._tmcClosedExercisesFolderPathRelative = tmcClosedExercisesFolderPathRelative;
        this._javaPath = javaPath;
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

    public getTmcLangsPath(): string {
        return path.join(this._tmcDataFolder, this._tmcLangsPathRelative);
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

    public getClosedExercisesFolderPath(): string {
        return path.join(this._tmcDataFolder, this._tmcClosedExercisesFolderPathRelative);
    }

    public getDataPath(): string {
        return this._tmcDataFolder;
    }

    public getJavaPath(): string {
        return this._javaPath;
    }

    public setJavaPath(javaPath: string): void {
        this._javaPath = javaPath;
    }
}
