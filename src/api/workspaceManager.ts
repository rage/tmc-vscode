import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { WORKSPACE_ROOT_FILE_TEXT, WORKSPACE_SETTINGS } from "../config/constants";
import Resources from "../config/resources";
import { Logger } from "../utils";
import { showNotification } from "../window";

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
            vscode.workspace.onDidChangeWorkspaceFolders(this._onDidChangeWorkspaceFolders),
            vscode.workspace.onDidOpenTextDocument(this._onDidOpenTextDocument),
        ];
    }

    /**
     * Currently active course based on active workspace, or `undefined` otherwise.
     */
    public get activeCourse(): string | undefined {
        const workspaceFile = vscode.workspace.workspaceFile;
        if (
            !workspaceFile ||
            workspaceFile.fsPath.startsWith(this._resources.workspaceFileFolder)
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
     * Checks whether or not the given `uri` is an exercise or not.
     * @param uri
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

    private _getActiveCourseWorkspace(): string | undefined {
        // The name is of form "workspaceName (workspace)"
        const workspaceName = vscode.workspace.name?.split(" ")[0];

        return workspaceName;
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
            if (!fs.existsSync(path.join(basedir, ".tmc"))) {
                fs.mkdirSync(path.join(basedir, ".tmc"), { recursive: true });
            }

            fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            return;
        }
    }

    /**
     * Refreshes current active course workspace by first making sure that the `.tmc` folder is at
     * the top and then lists all that course's open exercises in alphanumeric order.
     */
    private async _refreshActiveCourseWorkspace(): Promise<Result<void, Error>> {
        const workspaceName = this._getActiveCourseWorkspace();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceName || !workspaceFolders) {
            Logger.warn("Attempted refresh for a non-course workspace.");
            return Ok.EMPTY;
        }

        const rootFolder = this._resources.workspaceRootFolder;
        const openExercises = this._exercises
            .filter((x) => x.status === ExerciseStatus.Open)
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
        if (workspaceFolders[0]?.name !== ".tmc") {
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
            const exercise = this._exercises.find((x) => x.uri === added.uri);
            if (!exercise) {
                incorrectFolderAdded = true;
            } else if (exercise.courseSlug === activeCourse) {
                exercise.status = ExerciseStatus.Open;
            }
        });

        e.removed.forEach((removed) => {
            const exercise = this._exercises.find((x) => x.uri === removed.uri);
            if (exercise) {
                exercise.status = ExerciseStatus.Closed;
            }
        });

        if (incorrectFolderAdded) {
            showNotification(
                `Exercises or folders you added to this workspace are not
                part of the current course ${activeCourse} and will be removed later.`,
                ["Ok", (): void => {}],
            );
        }
    }

    private _onDidOpenTextDocument(e: vscode.TextDocument): void {
        const activeCourse = this.activeCourse;
        if (!activeCourse) {
            return;
        }

        // TODO: Check that document is a valid exercise
        Logger.debug("Text document languageId " + e.languageId);
        switch (e.languageId) {
            case "c":
            case "cpp":
            case "objective-c":
            case "objective-cpp":
                if (!vscode.extensions.getExtension("ms-vscode.cpptools")) {
                    this.addWorkspaceRecommendation(activeCourse, ["ms-vscode.cpptools"]);
                }
                break;
            case "csharp":
                if (!vscode.extensions.getExtension("ms-dotnettools.csharp")) {
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
                if (
                    !vscode.extensions.getExtension("ms-python.python") ||
                    !vscode.extensions.getExtension("ms-python.vscode-pylance")
                ) {
                    this.addWorkspaceRecommendation(activeCourse, [
                        "ms-python.python",
                        "ms-python.vscode-pylance",
                    ]);
                }
                break;
            case "java":
                if (!vscode.extensions.getExtension("vscjava.vscode-java-pack")) {
                    this.addWorkspaceRecommendation(activeCourse, ["vscjava.vscode-java-pack"]);
                }
                break;
        }
    }
}
