
export default class Storage {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly tmcDataFolder: string;
    public readonly tmcLangsPath: string;

    constructor(cssFolder: string, htmlFolder: string, tmcDataFolder: string, tmcLangsPath: string) {
        this.cssFolder = cssFolder;
        this.htmlFolder = htmlFolder;
        this.tmcDataFolder = tmcDataFolder;
        this.tmcLangsPath = tmcLangsPath;
    }

}
