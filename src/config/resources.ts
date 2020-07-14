import * as fs from "fs-extra";
import * as path from "path";

import { Logger } from "../utils";

import { WORKSPACE_SETTINGS_INSIDER } from "./constants";

export default class Resources {
    public readonly cssFolder: string;
    public readonly htmlFolder: string;
    public readonly mediaFolder: string;
    public readonly extensionVersion: string;
    private tmcDataFolder: string;
    private javaPath: string;
    private cliPath: string;

    private readonly tmcLangsPathRelative: string;
    private readonly tmcWorkspaceFolderPathRelative: string;
    private readonly tmcWorkspaceFilePathRelative: string;
    private readonly tmcExercisesFolderPathRelative: string;
    private readonly tmcClosedExercisesFolderPathRelative: string;

    constructor(
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
        cliPath: string,
    ) {
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
        this.cliPath = cliPath;
    }

    public setDataPath(dataPath: string): void {
        this.tmcDataFolder = dataPath;
    }

    public getCliPath(): string {
        return this.cliPath;
    }

    public getTmcLangsPath(): string {
        return path.join(this.tmcDataFolder, this.tmcLangsPathRelative);
    }

    public getWorkspaceFolderPath(): string {
        return path.join(this.tmcDataFolder, this.tmcWorkspaceFolderPathRelative);
    }

    public createWorkspaceFile(courseName: string): void {
        const tmcWorkspaceFilePath = path.join(
            this.tmcDataFolder,
            this.tmcWorkspaceFolderPathRelative,
            courseName + ".code-workspace",
        );
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(
                tmcWorkspaceFilePath,
                JSON.stringify({ folders: [{}], ...WORKSPACE_SETTINGS_INSIDER }),
            );
            Logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    }

    public getWorkspaceFilePath(courseName?: string): string {
        if (courseName) {
            return path.join(
                this.tmcDataFolder,
                this.tmcWorkspaceFolderPathRelative,
                courseName + ".code-workspace",
            );
        }
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
