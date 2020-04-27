import * as path from "path";
import Storage from "./storage";

export default class Resources {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly mediaFolder: string;
    public readonly extensionVersion: string;
    private tmcDataFolder: string;
    private javaPath: string;

    private readonly tmcLangsPathRelative: string;
    private readonly tmcWorkspaceFolderPathRelative: string;
    private readonly tmcWorkspaceFilePathRelative: string;
    private readonly tmcExercisesFolderPathRelative: string;
    private readonly tmcClosedExercisesFolderPathRelative: string;
    private readonly storage: Storage;

    constructor(
        storage: Storage,
        cssFolder: string,
        extensionVersion: string,
        htmlFolder: string,
        mediaFolder: string,
        tmcDataFolder: string,
        tmcLangsPathRelative: string,
        tmcWorkspaceFolderPathRelative: string,
        tmcWorkspaceFilePathRelative: string,
        tmcExercisesFolderPathRelative: string,
        tmcClosedExercisesFolderPathRelative: string,
        javaPath: string,
    ) {
        this.storage = storage;
        this.cssFolder = cssFolder;
        this.extensionVersion = extensionVersion;
        this.htmlFolder = htmlFolder;
        this.mediaFolder = mediaFolder;
        this.tmcDataFolder = tmcDataFolder;
        this.tmcLangsPathRelative = tmcLangsPathRelative;
        this.tmcWorkspaceFolderPathRelative = tmcWorkspaceFolderPathRelative;
        this.tmcWorkspaceFilePathRelative = tmcWorkspaceFilePathRelative;
        this.tmcExercisesFolderPathRelative = tmcExercisesFolderPathRelative;
        this.tmcClosedExercisesFolderPathRelative = tmcClosedExercisesFolderPathRelative;
        this.javaPath = javaPath;
    }

    public setDataPath(dataPath: string): void {
        this.tmcDataFolder = dataPath;
        const settings = this.storage.getExtensionSettings() || { dataPath: "" };
        settings.dataPath = dataPath;
        this.storage.updateExtensionSettings(settings);
    }

    public getTmcLangsPath(): string {
        return path.join(this.tmcDataFolder, this.tmcLangsPathRelative);
    }

    public getWorkspaceFolderPath(): string {
        return path.join(this.tmcDataFolder, this.tmcWorkspaceFolderPathRelative);
    }

    public getWorkspaceFilePath(): string {
        return path.join(this.tmcDataFolder, this.tmcWorkspaceFilePathRelative);
    }

    public getExercisesFolderPath(): string {
        return path.join(this.tmcDataFolder, this.tmcExercisesFolderPathRelative);
    }

    public getClosedExercisesFolderPath(): string {
        return path.join(this.tmcDataFolder, this.tmcClosedExercisesFolderPathRelative);
    }

    public getDataPath(): string {
        return this.tmcDataFolder;
    }

    public getJavaPath(): string {
        return this.javaPath;
    }

    public setJavaPath(javaPath: string): void {
        this.javaPath = javaPath;
    }
}
