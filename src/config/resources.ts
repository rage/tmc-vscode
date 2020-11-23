import * as path from "path";

export default class Resources {
    private readonly _tmcWorkspaceFolderPathRelative: string;
    private readonly _tmcExercisesFolderPathRelative: string;
    private _tmcDataFolder: string;
    private _cliPath: string;

    constructor(
        readonly cssFolder: string,
        readonly extensionVersion: string,
        readonly htmlFolder: string,
        readonly mediaFolder: string,
        tmcDataFolder: string,
        tmcWorkspaceFolderPathRelative: string,
        tmcExercisesFolderPathRelative: string,
        cliPath: string,
    ) {
        this._tmcDataFolder = tmcDataFolder;
        this._tmcWorkspaceFolderPathRelative = tmcWorkspaceFolderPathRelative;
        this._tmcExercisesFolderPathRelative = tmcExercisesFolderPathRelative;
        this._cliPath = cliPath;
    }

    get dataPath(): string {
        return this._tmcDataFolder;
    }

    set dataPath(newPath: string) {
        this._tmcDataFolder = newPath;
    }

    get cliPath(): string {
        return this._cliPath;
    }

    set cliPath(newPath: string) {
        this._cliPath = newPath;
    }

    get workspaceFolderPath(): string {
        return path.join(this._tmcDataFolder, this._tmcWorkspaceFolderPathRelative);
    }

    get exercisesFolderPath(): string {
        return path.join(this._tmcDataFolder, this._tmcExercisesFolderPathRelative);
    }

    public getWorkspaceFilePath(courseName: string): string {
        return path.join(
            this._tmcDataFolder,
            this._tmcWorkspaceFolderPathRelative,
            courseName + ".code-workspace",
        );
    }
}
