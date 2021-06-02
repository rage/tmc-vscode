import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import {
    HIDE_META_FILES,
    SHOW_META_FILES,
    WATCHER_EXCLUDE,
    WORKSPACE_ROOT_FILE_NAME,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_ROOT_FOLDER_NAME,
    WORKSPACE_SETTINGS,
} from "../config/constants";
import Resources, { EditorKind } from "../config/resources";
import { Logger } from "../utils";

export enum ExerciseStatus {
    Closed = "closed",
    Missing = "missing",
    Open = "opened",
}

export interface WorkspaceExercise {
    courseSlug: string;
    exerciseSlug: string;
    status: ExerciseStatus;
    uri: vscode.Uri;
}

interface ConfigurationProperties {
    default?: unknown;
    type?: string;
    description?: string;
    scope?: string;
    enum?: Array<string>;
    enumDescriptions?: Array<string>;
}

/**
 * Class for managing active workspace.
 */
export default class WorkspaceManager implements vscode.Disposable {
    private _exercises: WorkspaceExercise[];
    private readonly _resources: Resources;
    private readonly _watcher: vscode.FileSystemWatcher;
    private readonly _disposables: vscode.Disposable[];

    /**
     * Creates a new instance of the WorkspaceManager class.
     * @param resources Resources instance for constructing the exercise path
     */
    constructor(resources: Resources, exercises?: WorkspaceExercise[]) {
        this._exercises = exercises ?? [];
        this._resources = resources;
        this._watcher = vscode.workspace.createFileSystemWatcher(
            this._resources.projectsDirectory + "/**",
            true,
            true,
            false,
        );
        this._watcher.onDidDelete((x) => this._fileDeleteAction(x.fsPath));
        this._disposables = [
            vscode.workspace.onDidChangeWorkspaceFolders((e) =>
                this._onDidChangeWorkspaceFolders(e),
            ),
            vscode.workspace.onDidOpenTextDocument((e) => this._onDidOpenTextDocument(e)),
        ];
    }

    /**
     * Currently active course based on active workspace, or `undefined` otherwise.
     */
    public get activeCourse(): string | undefined {
        const workspaceFile = vscode.workspace.workspaceFile;
        if (
            !workspaceFile ||
            path.relative(workspaceFile.fsPath, this._resources.workspaceFileFolder) !== ".."
        ) {
            return undefined;
        }

        // Strip "(workspace)" part of the name
        return vscode.workspace.name?.split(" ")[0];
    }

    /**
     * Currently active exercise based on active editor, or `undefined` otherwise.
     */
    public get activeExercise(): Readonly<WorkspaceExercise> | undefined {
        const uri = vscode.window.activeTextEditor?.document.uri;
        return uri && this.getExerciseByPath(uri);
    }

    /**
     * Currently active course workspace uri, or `undefined` otherwise.
     */
    public get workspaceFileUri(): vscode.Uri | undefined {
        const workspaceFile = vscode.workspace.workspaceFile;
        if (
            !workspaceFile ||
            path.relative(workspaceFile.fsPath, this._resources.workspaceFileFolder) !== ".."
        ) {
            return undefined;
        }
        return workspaceFile;
    }

    public async setExercises(exercises: WorkspaceExercise[]): Promise<Result<void, Error>> {
        this._exercises = exercises;
        return this._refreshActiveCourseWorkspace();
    }

    public getExerciseByPath(exercise: vscode.Uri): Readonly<WorkspaceExercise> | undefined {
        // File is part of exercise if and only if it belongs to an exercise's subfolder
        return this._exercises.find(
            (x) => !path.relative(x.uri.fsPath, exercise.fsPath).startsWith(".."),
        );
    }

    public getExerciseBySlug(
        courseSlug: string,
        exerciseSlug: string,
    ): Readonly<WorkspaceExercise> | undefined {
        return this._exercises.find(
            (x) => x.courseSlug === courseSlug && x.exerciseSlug === exerciseSlug,
        );
    }

    public getExercises(): ReadonlyArray<WorkspaceExercise> {
        return this._exercises;
    }

    public getExercisesByCourseSlug(courseSlug: string): ReadonlyArray<WorkspaceExercise> {
        return this._exercises.filter((x) => x.courseSlug === courseSlug);
    }

    /**
     * Checks whether or not the given `Uri` is an exercise or not.
     */
    public uriIsExercise(uri: vscode.Uri): boolean {
        const exerciseFolderPath = this._resources.projectsDirectory;
        const relation = path.relative(exerciseFolderPath, uri.fsPath);
        return !relation.startsWith("..");
    }

    public addExercise(exercise: WorkspaceExercise): void {
        this._exercises = this._exercises.concat(exercise);
    }

    public openCourseExercises(
        courseSlug: string,
        exerciseSlugs: string[],
    ): Promise<Result<void, Error>> {
        this._exercises.forEach((x) => {
            if (x.courseSlug === courseSlug && exerciseSlugs.includes(x.exerciseSlug)) {
                x.status = ExerciseStatus.Open;
            }
        });

        return this._refreshActiveCourseWorkspace();
    }

    public closeCourseExercises(
        courseSlug: string,
        exerciseSlugs: string[],
    ): Promise<Result<void, Error>> {
        this._exercises.forEach((x) => {
            if (x.courseSlug === courseSlug && exerciseSlugs.includes(x.exerciseSlug)) {
                x.status = ExerciseStatus.Closed;
            }
        });

        return this._refreshActiveCourseWorkspace();
    }

    /**
     * Adds extension recommendations to current course workspace.
     *
     * @param workspace
     * @param extensions
     */
    public addWorkspaceRecommendation(workspace: string, extensions: string[]): void {
        const pathToWorkspace = path.join(this._resources.getWorkspaceFilePath(workspace));
        const workspaceData = JSON.parse(fs.readFileSync(pathToWorkspace, "utf-8"));
        let recommendations: string[] | undefined = workspaceData.extensions?.recommendations;
        if (recommendations) {
            Logger.debug("Current workspace recommendations", recommendations);
            recommendations = _.union(recommendations, extensions);
        }
        const workspaceDataRecommend = {
            ...workspaceData,
            extensions: { recommendations: recommendations ?? extensions },
        };
        Logger.debug("New workspace data", workspaceDataRecommend);
        fs.writeFileSync(pathToWorkspace, JSON.stringify(workspaceDataRecommend));
    }

    public createWorkspaceFile(courseName: string): void {
        const tmcWorkspaceFilePath = this._resources.getWorkspaceFilePath(courseName);
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS));
            Logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    }

    public dispose(): void {
        this._watcher.dispose();
        this._disposables.forEach((x) => x.dispose());
    }

    public async excludeMetaFilesInWorkspace(hide: boolean): Promise<void> {
        const value = hide ? HIDE_META_FILES : SHOW_META_FILES;
        await this.updateWorkspaceSetting("files.exclude", value);
    }

    /**
     * Returns the section for the Workspace setting (i.e. .code-workspace).
     * If section not found in multi-root workspace file, returns User scope setting.
     * @param section A dot-separated identifier.
     */
    public getWorkspaceSettings(section?: string): vscode.WorkspaceConfiguration {
        if (this.activeCourse) {
            return vscode.workspace.getConfiguration(section, this.workspaceFileUri);
        }
        return vscode.workspace.getConfiguration(section);
    }

    public async verifyWorkspaceSettingsIntegrity(): Promise<void> {
        if (this.activeCourse) {
            Logger.log("TMC Workspace open, verifying workspace settings integrity.");
            const hideMetaFiles = this.getWorkspaceSettings("testMyCode").get<boolean>(
                "hideMetaFiles",
                true,
            );
            await this.excludeMetaFilesInWorkspace(hideMetaFiles);
            await this._ensureSettingsAreStoredInMultiRootWorkspace();
            await this._verifyWatcherPatternExclusion();
            await this._forceTMCWorkspaceSettings();
        }
    }

    /**
     * Updates a section for the TMC Workspace.code-workspace file, if the workspace is open.
     * @param section Configuration name, supports dotted names.
     * @param value The new value
     */
    public async updateWorkspaceSetting(section: string, value: unknown): Promise<void> {
        const activeCourse = this.activeCourse;
        if (activeCourse) {
            let newValue = value;
            if (value instanceof Object) {
                const oldValue = this.getWorkspaceSettings(section);
                newValue = { ...oldValue, ...value };
            }
            await vscode.workspace
                .getConfiguration(
                    undefined,
                    vscode.Uri.file(this._resources.getWorkspaceFilePath(activeCourse)),
                )
                .update(section, newValue, vscode.ConfigurationTarget.Workspace);
        }
    }

    /**
     * Ensures that settings defined in package.json are written to the multi-root
     * workspace file. If the key can't be found in the .code-workspace file, it will write the
     * setting defined in the User scope to the file. Last resort, default value.
     *
     * This is to ensure that workspace defined settings really overrides the user scope...
     * https://github.com/microsoft/vscode/issues/58038
     */
    private async _ensureSettingsAreStoredInMultiRootWorkspace(): Promise<void> {
        const extension = vscode.extensions.getExtension("moocfi.test-my-code");
        const extensionDefinedSettings: Record<string, ConfigurationProperties> =
            extension?.packageJSON?.contributes?.configuration?.properties;
        for (const [key, value] of Object.entries(extensionDefinedSettings)) {
            if (value.scope !== "application" && value.type === "boolean") {
                const codeSettings = this.getWorkspaceSettings().inspect<boolean>(key);
                if (codeSettings?.workspaceValue !== undefined) {
                    await this.updateWorkspaceSetting(key, codeSettings.workspaceValue);
                } else if (codeSettings?.globalValue !== undefined) {
                    await this.updateWorkspaceSetting(key, codeSettings.globalValue);
                } else {
                    await this.updateWorkspaceSetting(key, codeSettings?.defaultValue);
                }
            }
        }
    }

    /**
     * Event listener function for workspace watcher delete.
     * @param targetPath Path to deleted item
     */
    private _fileDeleteAction(targetPath: string): void {
        const basedir = this._resources.projectsDirectory;
        const rootFilePath = this._resources.workspaceRootFolder.fsPath;
        Logger.debug("Target path deleted", targetPath);
        if (path.relative(rootFilePath, targetPath) === "") {
            Logger.log(`Root file deleted ${targetPath}, fixing issue.`);
            if (!fs.existsSync(path.join(basedir, WORKSPACE_ROOT_FILE_NAME))) {
                fs.mkdirSync(path.join(basedir, WORKSPACE_ROOT_FILE_NAME), { recursive: true });
            }

            fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            return;
        }
    }

    /**
     * Force some settings for TMC multi-root workspaces that we want.
     */
    private async _forceTMCWorkspaceSettings(): Promise<void> {
        await this.updateWorkspaceSetting("explorer.decorations.colors", false);
        await this.updateWorkspaceSetting("explorer.decorations.badges", true);
        await this.updateWorkspaceSetting("problems.decorations.enabled", false);
    }

    /**
     * Refreshes current active course workspace by first making sure that the `.tmc` folder is at
     * the top and then lists all that course's open exercises in alphanumeric order.
     */
    private async _refreshActiveCourseWorkspace(): Promise<Result<void, Error>> {
        const workspaceName = this.activeCourse;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceName || !workspaceFolders) {
            Logger.warn("Attempted refresh for a non-course workspace.");
            return Ok.EMPTY;
        }

        const rootFolder = this._resources.workspaceRootFolder;
        const openExercises = this._exercises
            .filter((x) => x.courseSlug === workspaceName && x.status === ExerciseStatus.Open)
            .sort((a, b) => a.exerciseSlug.localeCompare(b.exerciseSlug))
            .map((x) => ({ uri: x.uri }));
        const correctStructure = [{ uri: rootFolder }, ...openExercises];
        if (
            _.zip(correctStructure, workspaceFolders).every(
                ([a, b]) => a?.uri.fsPath === b?.uri.fsPath,
            )
        ) {
            Logger.debug("Workspace refresh was a no-op.");
            return Ok.EMPTY;
        }

        Logger.log("Refreshing workspace structure in the current workspace");
        if (workspaceFolders[0]?.name !== WORKSPACE_ROOT_FOLDER_NAME) {
            Logger.warn("Fixing incorrect root folder. This may restart the extension.");
        }

        const deleteCount = workspaceFolders.length;
        Logger.debug(`Replacing ${deleteCount} workspace folders with ${correctStructure.length}`);
        const success = vscode.workspace.updateWorkspaceFolders(
            0,
            deleteCount,
            ...correctStructure,
        );
        if (!success) {
            Logger.error("Replace operation failed.");
            Logger.debug("Failed with folders:", ...correctStructure);
        }

        return success ? Ok.EMPTY : Err(new Error("Failed to refresh active workspace."));
    }

    private _onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent): void {
        const activeCourse = this.activeCourse;

        let incorrectFolderAdded = false;
        e.added.forEach((added) => {
            const exercise = this._exercises.find((x) => x.uri.fsPath === added.uri.fsPath);
            if (!exercise) {
                incorrectFolderAdded = true;
            } else if (exercise.courseSlug === activeCourse) {
                exercise.status = ExerciseStatus.Open;
            }
        });

        e.removed.forEach((removed) => {
            const exercise = this._exercises.find((x) => x.uri.fsPath === removed.uri.fsPath);
            if (exercise) {
                exercise.status = ExerciseStatus.Closed;
            }
        });

        if (incorrectFolderAdded) {
            Logger.warn(
                `Folders added that are not part of course ${activeCourse}. These may be removed later.`,
            );
        }
        if (e.added.length > 5) {
            vscode.commands.executeCommand("workbench.files.action.collapseExplorerFolders");
        }
    }

    private _onDidOpenTextDocument(e: vscode.TextDocument): void {
        const activeCourse = this.activeCourse;
        if (!activeCourse) {
            return;
        }

        // TODO: Check that document is a valid exercise
        const isCode = this._resources.editorKind === EditorKind.Code;
        Logger.debug("Text document languageId " + e.languageId);
        switch (e.languageId) {
            case "c":
            case "cpp":
            case "objective-c":
            case "objective-cpp":
                if (isCode && !vscode.extensions.getExtension("ms-vscode.cpptools")) {
                    this.addWorkspaceRecommendation(activeCourse, ["ms-vscode.cpptools"]);
                }
                break;
            case "csharp":
                if (isCode && !vscode.extensions.getExtension("ms-dotnettools.csharp")) {
                    this.addWorkspaceRecommendation(activeCourse, ["ms-dotnettools.csharp"]);
                }
                break;
            case "markdown":
                vscode.commands.executeCommand("markdown.showPreview", e.uri);
                break;
            case "r":
                if (!vscode.extensions.getExtension("ikuyadeu.r")) {
                    this.addWorkspaceRecommendation(activeCourse, ["ikuyadeu.r"]);
                }
                break;
            case "python":
                if (!vscode.extensions.getExtension("ms-python.python")) {
                    if (isCode && !vscode.extensions.getExtension("ms-python.vscode-pylance")) {
                        this.addWorkspaceRecommendation(activeCourse, [
                            "ms-python.vscode-pylance",
                            "ms-python.python",
                        ]);
                    } else {
                        this.addWorkspaceRecommendation(activeCourse, ["ms-python.python"]);
                    }
                }

                break;
            case "java":
                if (isCode && !vscode.extensions.getExtension("vscjava.vscode-java-pack")) {
                    this.addWorkspaceRecommendation(activeCourse, ["vscjava.vscode-java-pack"]);
                }
                break;
        }
    }

    /**
     * Makes sure that folders and its contents aren't deleted by our watcher.
     * .vscode folder needs to be unwatched, otherwise adding settings to WorkspaceFolder level
     * doesn't work. For example defining Python interpreter for the Exercise folder.
     */
    private async _verifyWatcherPatternExclusion(): Promise<void> {
        await this.updateWorkspaceSetting("files.watcherExclude", { ...WATCHER_EXCLUDE });
    }
}
