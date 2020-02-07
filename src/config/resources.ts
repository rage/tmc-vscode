
export default class Resources {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly tmcDataFolder: string;
    public readonly tmcLangsPath: string;
    public readonly tmcWorkspaceFolder: string;
    public readonly tmcWorkspaceFilePath: string;
    public readonly tmcExercisesFolderPath: string;
    public readonly mediaFolder: string;

    constructor(cssFolder: string, htmlFolder: string, tmcDataFolder: string,
                tmcLangsPath: string, tmcWorkspaceFolder: string, tmcWorkspaceFilePath: string,
                tmcExercisesFolderPath: string, mediaFolder: string) {
        this.cssFolder = cssFolder;
        this.htmlFolder = htmlFolder;
        this.tmcDataFolder = tmcDataFolder;
        this.tmcLangsPath = tmcLangsPath;
        this.tmcWorkspaceFolder = tmcWorkspaceFolder;
        this.tmcWorkspaceFilePath = tmcWorkspaceFilePath;
        this.tmcExercisesFolderPath = tmcExercisesFolderPath;
        this.mediaFolder = mediaFolder;
    }

}
