
export default class Storage {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly tmcDataFolder: string;
    public readonly tmcLangsPath: string;
    public readonly mediaFolder: string;

    constructor(cssFolder: string, htmlFolder: string, tmcDataFolder: string,
                tmcLangsPath: string, mediaFolder: string) {
        this.cssFolder = cssFolder;
        this.htmlFolder = htmlFolder;
        this.tmcDataFolder = tmcDataFolder;
        this.tmcLangsPath = tmcLangsPath;
        this.mediaFolder = mediaFolder;
    }

}
