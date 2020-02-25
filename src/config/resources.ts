
export default class Resources {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly tmcDataFolder: string;
    public readonly tmcLangsPath: string;
    public readonly tmcWorkspaceFolder: string;
    public readonly tmcWorkspaceFilePath: string;
    public readonly tmcExercisesFolderPath: string;
    public readonly tmcClosedExercisesFolderPath: string;
    public readonly mediaFolder: string;
    public readonly extensionVersion: string;

    constructor(cssFolder: string, extensionVersion: string, htmlFolder: string, tmcDataFolder: string,
                tmcLangsPath: string, tmcWorkspaceFolder: string, tmcWorkspaceFilePath: string,
                tmcExercisesFolderPath: string, tmcClosedExercisesFolderPath: string, mediaFolder: string) {
        this.cssFolder = cssFolder;
        this.extensionVersion = extensionVersion;
        this.htmlFolder = htmlFolder;
        this.tmcDataFolder = tmcDataFolder;
        this.tmcLangsPath = tmcLangsPath;
        this.tmcWorkspaceFolder = tmcWorkspaceFolder;
        this.tmcWorkspaceFilePath = tmcWorkspaceFilePath;
        this.tmcExercisesFolderPath = tmcExercisesFolderPath;
        this.tmcClosedExercisesFolderPath = tmcClosedExercisesFolderPath;
        this.mediaFolder = mediaFolder;
    }

}
