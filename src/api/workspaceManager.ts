import { sync as delSync } from "del";
import du = require("du");
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import {
    WORKSPACE_ROOT_FILE,
    WORKSPACE_ROOT_FILE_TEXT,
    WORKSPACE_SETTINGS,
} from "../config/constants";
import Resources from "../config/resources";
import Storage from "../config/storage";
import { ExerciseStatus, LocalExerciseData } from "../config/types";
import { ExerciseExistsError } from "../errors";
import * as UITypes from "../ui/types";
import { isCorrectWorkspaceOpen, Logger } from "../utils";

/**
 * Class for managing, opening and closing of exercises on disk.
 */
export default class WorkspaceManager {
    private readonly _pathToId: Map<string, number>;
    private readonly _idToData: Map<number, LocalExerciseData>;
    private readonly _storage: Storage;
    private readonly _resources: Resources;
    private _watcher: vscode.FileSystemWatcher;

    /**
     * Creates a new instance of the WorkspaceManager class.
     * @param storage Storage object for persistent data storing
     * @param resources Resources instance for constructing the exercise path
     */
    constructor(storage: Storage, resources: Resources) {
        this._storage = storage;
        this._resources = resources;
        const storedData = this._storage.getExerciseData();
        if (storedData) {
            this._idToData = new Map(storedData.map((x) => [x.id, x]));
            this._pathToId = new Map(storedData.map((x) => [x.path, x.id]));
        } else {
            this._idToData = new Map();
            this._pathToId = new Map();
        }
        this._watcher = vscode.workspace.createFileSystemWatcher(
            this._resources.projectsDirectory + "/**",
            true,
            true,
            false,
        );
    }

    public async initialize(): Promise<void> {
        Logger.log("Initializing workspace");
        await this._verifyCorrectExercisesOpenInCourseWorkspace();
    }

    public startWatcher(): void {
        Logger.log("Starting workspace watcher.");
        this._verifyCourseWorkspaceRootFolderAndFileExists();
        this._watcher.onDidDelete((x) => {
            this._fileDeleteAction(x.fsPath);
        });
    }

    public setExerciseStatus(id: number, status: ExerciseStatus): void {
        const data = this._idToData.get(id);
        if (data) {
            data.status = status;
            this._idToData.set(id, data);
            this._updatePersistentData();
        }
    }

    /**
     * Adds new exercise to be managed on disk.
     *
     * @param exercise Exercise to add.
     * @returns Unique file path for the exercise.
     */
    public addExercise(exercise: LocalExerciseData): Result<void, Error> {
        if (this._idToData.has(exercise.id)) {
            return Err(new ExerciseExistsError("Data for this exercise already exists."));
        }

        this._pathToId.set(exercise.path, exercise.id);
        this._idToData.set(exercise.id, exercise);
        return Ok.EMPTY;
    }

    /**
     * Gets the matching exercise's data for the given path, if managed by this object.
     * @param exerciseFolder Path to exercise folder used for matching with the data
     */
    public getExerciseDataByPath(exerciseFolder: string): Result<LocalExerciseData, Error> {
        const id = this._pathToId.get(exerciseFolder);
        if (!id) {
            return new Err(new Error(`Exercise ID not found for ${exerciseFolder}`));
        }
        return this.getExerciseDataById(id);
    }

    /**
     * Gets the matching exercise's data for the given path, if managed by this object.
     * @param exerciseFolder Path to exercise folder used for matching with the data
     */
    public getExerciseDataById(id: number): Result<LocalExerciseData, Error> {
        const data = this._idToData.get(id);
        if (!data) {
            return new Err(new Error(`Exercise data missing for ${id}`));
        }
        return new Ok(data);
    }

    /**
     * Returns all exercise data for given course name.
     * @param courseName
     */
    public getAllExerciseDataByCourseName(courseName: string): LocalExerciseData[] {
        const exercises: LocalExerciseData[] = [];
        for (const data of this._idToData.values()) {
            if (data.course === courseName) {
                exercises.push(data);
            }
        }
        return exercises;
    }

    /**
     * Gets the matching exercise's ID for the given path, if managed by this object.
     * @param exerciseFolder Path to exercise folder used for matching with the id
     */
    public getExerciseIdByPath(exerciseFolder: string): Result<number, Error> {
        const id = this._pathToId.get(exerciseFolder);
        return id !== undefined
            ? new Ok(id)
            : new Err(new Error(`Exercise ID not found for ${exerciseFolder}`));
    }

    /**
     * Get the Exercise ID for the currently open text editor
     */
    public getCurrentExerciseId(): number | undefined {
        const editorPath = vscode.window.activeTextEditor?.document.fileName;
        return this.checkIfPathIsExercise(editorPath);
    }

    /**
     * Checks if a given file is a part of a TMC exercise and returns its id if it is
     * @param filePath
     * @returns Exercise ID if successful
     */
    public checkIfPathIsExercise(filePath: string | undefined): number | undefined {
        if (!filePath) {
            return undefined;
        }
        const exerciseFolderPath = this._resources.projectsDirectory;
        const relation = path.relative(exerciseFolderPath, filePath);

        if (relation.startsWith("..")) {
            return undefined;
        }
        const idResult = this.getExerciseIdByPath(
            path.join(exerciseFolderPath, ...relation.split(path.sep, 3).slice(0, 3)),
        );

        if (idResult.err) {
            return undefined;
        }
        return idResult.val;
    }

    /**
     * Moves a folder and all content from one location to another.
     * @param oldPath
     * @param newPath
     */
    public async moveFolder(oldPath: string, newPath: string): Promise<Result<boolean, Error>> {
        const newParent = path.resolve(newPath, "..");
        fs.ensureDirSync(newParent);
        if (fs.existsSync(newPath)) {
            return new Err(new Error("Target folder already exists."));
        }
        try {
            fs.moveSync(oldPath, newPath);
        } catch (err) {
            Logger.error(err);
            if (fs.existsSync(newPath) && (await du(oldPath)) < (await du(newPath))) {
                return new Ok(false);
            }
            try {
                fs.removeSync(newPath);
            } catch (err2) {
                Logger.error(err2);
                return new Err(
                    new Error(
                        "Folder move operation failed, " +
                            "please try closing the workspace and make sure that any files are not in use. " +
                            "Some files could not be cleaned up from the target directory.",
                    ),
                );
            }
            return new Err(
                new Error(
                    "Folder move operation failed, please try closing the workspace and make sure that any files are not in use.",
                ),
            );
        }
        return new Ok(true);
    }

    /**
     * Opens exercise in .code-workspace file
     * if given courseName and currently open workspace path match.
     *
     * Sets their status as OPEN in persistent storage.
     *
     * @param exerciseIds Exercise IDs to open or/and mark as open
     * @returns Array of { id: number; status: UITypes.ExerciseStatus } to post to webview.
     */
    public async openExercise(
        courseName: string,
        ...exerciseIds: number[]
    ): Promise<Result<{ id: number; status: UITypes.ExerciseStatus }[], Error>> {
        const newStatuses = await this._setExerciseStatus(
            ExerciseStatus.CLOSED,
            ExerciseStatus.OPEN,
            ...exerciseIds,
        );
        const refreshResult = await this._refreshActiveCourseWorkspace();
        return refreshResult.err ? refreshResult : Ok(newStatuses);
    }

    /**
     * Closes exercise in .code-workspace file
     * if given courseName and currently open workspace match.
     *
     * Sets their status as CLOSED in persistent storage.
     *
     * @param ids Exercise IDs to close or/and mark as closed
     * @returns Array of { id: number; status: UITypes.ExerciseStatus } to post to webview.
     */
    public async closeExercise(
        courseName: string,
        ...exerciseIds: number[]
    ): Promise<Result<{ id: number; status: UITypes.ExerciseStatus }[], Error>> {
        const newStatuses = await this._setExerciseStatus(
            ExerciseStatus.OPEN,
            ExerciseStatus.CLOSED,
            ...exerciseIds,
        );
        const refreshResult = await this._refreshActiveCourseWorkspace();
        return refreshResult.err ? refreshResult : Ok(newStatuses);
    }

    /**
     * Deletes exercise from disk if present and clears all data related to it.
     * @param exerciseId Exercise ID to delete
     */
    public async deleteExercise(...ids: number[]): Promise<void> {
        for (const id of ids) {
            const data = this._idToData.get(id);
            if (data) {
                const openPath = data.path;
                const deleted = delSync(openPath, { force: true });
                Logger.debug("Delete exercise deleted", ...deleted);
                this._pathToId.delete(openPath);
                this._idToData.delete(id);
            }
        }
        await this._updatePersistentData();
    }

    public getAllExercises(): LocalExerciseData[] {
        return Array.from(this._idToData.values());
    }

    public async setExerciseStatusAsMissing(id: number): Promise<void> {
        const data = this._idToData.get(id);
        if (data) {
            data.status = ExerciseStatus.MISSING;
            this._idToData.set(id, data);
            await this._updatePersistentData();
        }
    }

    public async setExerciseStatusAsClosed(id: number): Promise<void> {
        const data = this._idToData.get(id);
        if (data) {
            data.status = ExerciseStatus.CLOSED;
            this._idToData.set(id, data);
            await this._updatePersistentData();
        }
    }

    public getExercisePathById(id: number): Result<string, Error> {
        const path = this._idToData.get(id)?.path;
        if (!path) {
            return Err(new Error("Invalid exercise ID"));
        }

        if (!fs.existsSync(path)) {
            Err(new Error(`Exercise data missing ${path}`));
        }

        return Ok(path);
    }

    public createWorkspaceFile(courseName: string): void {
        const tmcWorkspaceFilePath = this._resources.getWorkspaceFilePath(courseName);
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS));
            Logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    }

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

    /**
     * Refreshes current active course workspace by first making sure that the `.tmc` folder is at
     * the top and then lists all that course's open exercises in alphanumeric order.
     */
    private async _refreshActiveCourseWorkspace(): Promise<Result<void, Error>> {
        Logger.log("Refreshing exercises in current workspace");

        // The name is of form "workspaceName (workspace)"
        const workspaceName = vscode.workspace.name?.split(" ")[0];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceName || !workspaceFolders) {
            return Ok.EMPTY;
        }

        const openExercises = this.getAllExerciseDataByCourseName(workspaceName)
            .filter((x) => x.status === ExerciseStatus.OPEN)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((x) => ({ uri: vscode.Uri.file(x.path) }));

        const rootFolder = this._resources.workspaceRootFolder;
        const tmcFolderIsRoot =
            workspaceFolders.length === 0 || workspaceFolders[0].uri !== rootFolder;
        if (!tmcFolderIsRoot) {
            Logger.warn("Fixing incorrect root folder. This may restart the extension.");
        }

        const startIndex = tmcFolderIsRoot ? 1 : 0;
        const deleteCount = workspaceFolders.length - startIndex || null;
        const foldersToAdd = tmcFolderIsRoot
            ? openExercises
            : [{ uri: rootFolder }, ...openExercises];

        Logger.debug(`Replacing ${deleteCount} workspace folders with ${foldersToAdd.length}`);
        const success = ((): boolean => {
            if (foldersToAdd.length === 0) {
                return vscode.workspace.updateWorkspaceFolders(startIndex, deleteCount);
            }
            return vscode.workspace.updateWorkspaceFolders(
                startIndex,
                deleteCount,
                ...foldersToAdd,
            );
        })();
        if (!success) {
            Logger.error("Replace operation failed.");
            Logger.debug("Failed with folders:", ...foldersToAdd);
        }

        return success ? Ok.EMPTY : Err(new Error("Failed to refresh active workspace."));
    }

    /**
     * Updates status to storage from oldStatus to newStatus for given exercise ids.
     *
     * Makes sure that the folder exists, otherwise marks exercise as MISSING.
     *
     * @param oldStatus
     * @param newStatus
     * @param ids
     */
    private async _setExerciseStatus(
        oldStatus: ExerciseStatus,
        newStatus: ExerciseStatus,
        ...ids: number[]
    ): Promise<Array<{ id: number; status: UITypes.ExerciseStatus }>> {
        const results: Array<{ id: number; status: UITypes.ExerciseStatus }> = [];
        const uistatus = newStatus === ExerciseStatus.OPEN ? "opened" : "closed";
        ids.forEach(async (id) => {
            const data = this._idToData.get(id);
            if (data && data.status === oldStatus) {
                if (!fs.existsSync(data.path)) {
                    await this.setExerciseStatusAsMissing(id);
                    results.push({ id: data.id, status: "new" });
                    return;
                }
                data.status = newStatus;
                this._idToData.set(data.id, data);
                results.push({ id: data.id, status: uistatus });
            }
        });
        await this._updatePersistentData();
        return results;
    }

    private async _updatePersistentData(): Promise<void> {
        return this._storage.updateExerciseData(Array.from(this._idToData.values()));
    }

    /**
     * Called only when extension activates.
     * Checks if the currently open .code-workspace file in VSCode is named as a course name.
     *
     * Makes sure all exercises with status OPEN is opened in course workspace.
     */
    private async _verifyCorrectExercisesOpenInCourseWorkspace(): Promise<void> {
        const workspaceAndCourseName = vscode.workspace.name?.split(" ")[0];
        Logger.log(`Workspace integrity check for ${workspaceAndCourseName}`);
        if (
            workspaceAndCourseName &&
            isCorrectWorkspaceOpen(this._resources, workspaceAndCourseName)
        ) {
            const exercises = this.getAllExerciseDataByCourseName(workspaceAndCourseName);
            const openIds: number[] = exercises
                .filter((ex) => ex.status === ExerciseStatus.OPEN)
                .map((ex) => ex.id);
            // TODO: Error handling for openExercise
            await this.openExercise(workspaceAndCourseName, ...openIds);
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
            if (!fs.existsSync(path.join(basedir, ".tmc"))) {
                fs.mkdirSync(path.join(basedir, ".tmc"), { recursive: true });
            }
            fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            return;
        }
    }

    /**
     * Verifies that .tmc/ folder exists and that TMC-Readme.md file and its contents is correct.
     * This folder needs to be as rootFolder in every Course Workspace, so that the
     * extension host doesn't restart when opening/closing exercises for course workspace.
     */
    private _verifyCourseWorkspaceRootFolderAndFileExists(): void {
        const rootFileFolder = this._resources.workspaceRootFolder.fsPath;
        const pathToRootFile = path.join(rootFileFolder, WORKSPACE_ROOT_FILE);
        if (!fs.existsSync(pathToRootFile)) {
            Logger.log(`Creating ${pathToRootFile}`);
            fs.mkdirSync(rootFileFolder, { recursive: true });
            fs.writeFileSync(pathToRootFile, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
        } else if (
            fs.readFileSync(pathToRootFile, { encoding: "utf-8" }) !== WORKSPACE_ROOT_FILE_TEXT
        ) {
            Logger.log(`Rewriting ${WORKSPACE_ROOT_FILE_TEXT} at ${pathToRootFile}`);
            fs.writeFileSync(pathToRootFile, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
        }
    }
}
