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
import { isCorrectWorkspaceOpen, Logger, sleep } from "../utils";
import { showNotification } from "../window";

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
            this._pathToId = new Map(storedData.map((x) => [this._getExercisePath(x), x.id]));
        } else {
            this._idToData = new Map();
            this._pathToId = new Map();
        }
        this._watcher = vscode.workspace.createFileSystemWatcher(
            this._resources.getWorkspaceFolderPath() + "/**",
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

    public setExerciseChecksum(exerciseId: number, checksum: string): void {
        const data = this._idToData.get(exerciseId);
        if (data) {
            this._idToData.set(exerciseId, { ...data, checksum });
            this._updatePersistentData();
        }
    }

    /**
     * Adds new exercise to be managed on disk.
     *
     * @param exercise Exercise to add.
     * @returns Unique file path for the exercise.
     */
    public async addExercise(exercise: LocalExerciseData): Promise<Result<string, Error>> {
        if (this._idToData.has(exercise.id)) {
            return new Err(new ExerciseExistsError("Data for this exercise already exists."));
        }

        const exerciseFolderPath = this._resources.getExercisesFolderPath();
        const exercisePath = path.join(
            exerciseFolderPath,
            exercise.organization,
            exercise.course,
            exercise.name,
        );

        this._pathToId.set(exercisePath, exercise.id);
        this._idToData.set(exercise.id, exercise);
        return Ok(exercisePath);
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
        const exerciseFolderPath = this._resources.getExercisesFolderPath();
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
     * @param ids Exercise IDs to open or/and mark as open
     * @returns Array of { id: number; status: UITypes.ExerciseStatus } to post to webview.
     */
    public async openExercise(
        courseName: string,
        ...ids: number[]
    ): Promise<Result<{ id: number; status: UITypes.ExerciseStatus }[], Error>> {
        let results: { id: number; status: UITypes.ExerciseStatus }[] = [];

        const courseExercises = this.getAllExerciseDataByCourseName(courseName);
        if (isCorrectWorkspaceOpen(this._resources, courseName)) {
            const result = await this._handleCourseWorkspaceExercisesChanges(
                true,
                courseExercises,
                ...ids,
            );
            if (result.err) {
                return result;
            }
        }
        results = await this._setExerciseStatus(ExerciseStatus.CLOSED, ExerciseStatus.OPEN, ...ids);

        return new Ok(results);
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
        ...ids: number[]
    ): Promise<Result<{ id: number; status: UITypes.ExerciseStatus }[], Error>> {
        let results: { id: number; status: UITypes.ExerciseStatus }[] = [];

        const courseExercises = this.getAllExerciseDataByCourseName(courseName);
        if (isCorrectWorkspaceOpen(this._resources, courseName)) {
            const result = await this._handleCourseWorkspaceExercisesChanges(
                false,
                courseExercises,
                ...ids,
            );
            if (result.err) {
                return result;
            }
        }
        results = await this._setExerciseStatus(ExerciseStatus.OPEN, ExerciseStatus.CLOSED, ...ids);

        return new Ok(results);
    }

    /**
     * Deletes exercise from disk if present and clears all data related to it.
     * @param exerciseId Exercise ID to delete
     */
    public async deleteExercise(...ids: number[]): Promise<void> {
        for (const id of ids) {
            const data = this._idToData.get(id);
            if (data) {
                const openPath = this._getExercisePath(data);
                const deleted = delSync(openPath, { force: true });
                Logger.debug("Delete exercise deleted", ...deleted);
                // Remove for loop when rid of Java
                for (let i = 0; i <= 15; i++) {
                    await sleep(100);
                    if (!fs.existsSync(openPath)) {
                        break;
                    }
                    Logger.debug("Remove this DelSync for loop when rid of Java  " + i);
                    delSync(openPath, { force: true });
                }
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
        const data = this._idToData.get(id);
        if (!data) {
            return new Err(new Error("Invalid exercise ID"));
        }
        const path = this._getExercisePath(data);
        if (!fs.existsSync(path)) {
            new Err(new Error(`Exercise data missing ${path}`));
        }
        return new Ok(path);
    }

    public createWorkspaceFile(courseName: string): void {
        const tmcWorkspaceFilePath = path.join(
            this._resources.getWorkspaceFolderPath(),
            courseName + ".code-workspace",
        );
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS));
            Logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    }

    public addWorkspaceRecommendation(workspace: string, extension: string): void {
        const pathToWorkspace = path.join(this._resources.getWorkspaceFilePath(workspace));
        const workspaceData = JSON.parse(fs.readFileSync(pathToWorkspace, "utf-8"));
        const recommendations: string[] | undefined = workspaceData.extensions?.recommendations;
        if (recommendations) {
            if (recommendations.includes(extension)) {
                return;
            }
            Logger.debug("Current recommendations", recommendations);
            const newRecommendations = recommendations.concat(extension);
            const newWorkspaceData = { ...workspaceData, extensions: { ...newRecommendations } };
            Logger.debug("Workspace data", newWorkspaceData);
            fs.writeFileSync(pathToWorkspace, JSON.stringify(newWorkspaceData));
        } else {
            const workspaceDataRecommend = {
                ...workspaceData,
                extensions: { recommendations: [extension] },
            };
            Logger.debug("New recommendations", workspaceDataRecommend);
            fs.writeFileSync(pathToWorkspace, JSON.stringify(workspaceDataRecommend));
        }
    }

    /**
     * Where the magic happens when opening/closing exercises in a course workspace.
     *
     * @param handleAsOpen Handle as opened, i.e. called by this.openExercise or this.closeExercise
     * @param exercises All exercises for given course found in storage
     * @param ids Ids to be closed or opened
     */
    private async _handleCourseWorkspaceExercisesChanges(
        handleAsOpen: boolean,
        exercises: LocalExerciseData[],
        ...ids: number[]
    ): Promise<Result<void, Error>> {
        const currentlyOpenFolders = vscode.workspace.workspaceFolders;
        if (currentlyOpenFolders === undefined) {
            return new Err(new Error("Currently open workspace returned undefined."));
        }
        let tmcFolderAsRoot = true;

        // Select all open exercises for course.
        const allOpen: vscode.Uri[] = exercises
            .filter((ex) => ex.status === ExerciseStatus.OPEN)
            .map((ex) => vscode.Uri.file(this._getExercisePath(ex)));
        allOpen.length > 0 && Logger.debug("Exercises with opened status:", ...allOpen);
        const toClose: vscode.Uri[] = [];
        const toOpen: vscode.Uri[] = [];

        const statusToCheck = handleAsOpen ? ExerciseStatus.CLOSED : ExerciseStatus.OPEN;
        ids.forEach((id) => {
            const data = this._idToData.get(id);
            if (data && data.status === statusToCheck) {
                const exercisePath = this._getExercisePath(data);
                const openAsUri = vscode.Uri.file(exercisePath);
                if (!fs.existsSync(exercisePath)) {
                    toOpen.push(openAsUri);
                    toClose.push(openAsUri);
                    return;
                }
                if (handleAsOpen) {
                    toOpen.push(openAsUri);
                } else {
                    toClose.push(openAsUri);
                }
            }
        });

        toOpen.length > 0 && Logger.debug("Following exercises should be open:", ...toOpen);
        toClose.length > 0 && Logger.debug("Following exercises should be closed:", ...toClose);

        if (currentlyOpenFolders.length === 0 || currentlyOpenFolders[0].name !== ".tmc") {
            Logger.warn("The .tmc folder is not set as root folder.");
            this._verifyCourseWorkspaceRootFolderAndFileExists();
            allOpen.push(
                vscode.Uri.file(path.join(this._resources.getWorkspaceFolderPath(), ".tmc")),
            );
            tmcFolderAsRoot = false;
        }

        let foldersToAdd = [];
        if (!handleAsOpen) {
            foldersToAdd = _.differenceBy(allOpen, toClose, "path");
        } else {
            foldersToAdd = _.unionBy(allOpen, toOpen, "path");
        }
        foldersToAdd = foldersToAdd.sort().map((e) => ({ uri: e }));
        foldersToAdd.length > 0 &&
            Logger.debug("Following folders will be opened:", ...foldersToAdd);
        Logger.debug("Currently open", ...currentlyOpenFolders);
        const start = tmcFolderAsRoot ? 1 : 0;
        const toRemove = currentlyOpenFolders.length - start;
        const remove = toRemove > 0 ? toRemove : null;

        if (!tmcFolderAsRoot) {
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            showNotification("The workspace first folder is not .tmc, fixing issue.");
        }

        const success = vscode.workspace.updateWorkspaceFolders(start, remove, ...foldersToAdd);

        if (success || _.differenceBy(currentlyOpenFolders, foldersToAdd, "uri.path").length <= 1) {
            return Ok.EMPTY;
        }
        Logger.log("Handle as open", handleAsOpen);
        Logger.log("Currently open folders", currentlyOpenFolders);
        Logger.log("All open status", allOpen);
        Logger.log("To open", toOpen);
        Logger.log("To close", toClose);
        Logger.error(
            "Failed to execute vscode.workspace.updateWorkspaceFolders with params",
            start,
            remove,
            foldersToAdd,
        );
        return new Err(new Error("Failed to handle opening or closing exercises for workspace."));
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
                if (!fs.existsSync(this._getExercisePath(data))) {
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

    private _getExercisePath(exerciseData: LocalExerciseData): string {
        return path.join(
            this._resources.getExercisesFolderPath(),
            exerciseData.organization,
            exerciseData.course,
            exerciseData.name,
        );
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
        const basedir = this._resources.getWorkspaceFolderPath();
        const rootFilePath = path.join(basedir, ".tmc", WORKSPACE_ROOT_FILE);
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
        const rootFileFolder = path.join(this._resources.getWorkspaceFolderPath(), ".tmc");
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
