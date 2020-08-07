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
import * as UITypes from "../ui/types";
import { isCorrectWorkspaceOpen, Logger } from "../utils";

import { ExerciseDetails } from "./types";
import { showNotification } from "./vscode";

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
        await this._workspaceIntegrityCheck();
    }

    public startWatcher(): void {
        Logger.log("Starting workspace watcher.");
        this._verifyWorkspaceRootFile();
        this._watcher.onDidDelete((x) => {
            this._fileDeleteAction(x.fsPath);
        });
    }

    public updateExerciseData(
        id: number,
        softDeadline: string | null,
        hardDeadline: string | null,
    ): void {
        const data = this._idToData.get(id);
        if (data) {
            data.deadline = hardDeadline;
            data.softDeadline = softDeadline;
            this._idToData.set(id, data);
            this._updatePersistentData();
        }
    }

    public updateExercisesStatus(id: number, status: ExerciseStatus): void {
        const data = this._idToData.get(id);
        if (data) {
            data.status = status;
            this._idToData.set(id, data);
            this._updatePersistentData();
        }
    }

    /**
     * Creates a unique human-readable directory path for an exercise and persistently manages its
     * relation to exercise's actual id.
     *
     * @param organizationSlug Organization slug used in the creation of exercise path
     * @param exerciseDetails Exercise details used in the creation of exercise path
     */
    public async createExerciseDownloadPath(
        softDeadline: string | null,
        organizationSlug: string,
        checksum: string,
        exerciseDetails: ExerciseDetails,
    ): Promise<Result<string, Error>> {
        if (this._idToData.has(exerciseDetails.exercise_id)) {
            const data = this._idToData.get(exerciseDetails.exercise_id);
            if (!data) {
                return new Err(new Error("Data integrity error"));
            }
            if (data.status === ExerciseStatus.MISSING) {
                await this.deleteExercise(exerciseDetails.exercise_id);
            } else if (data.checksum !== checksum) {
                if (data.status === ExerciseStatus.OPEN) {
                    await this.closeExercise(
                        exerciseDetails.course_name,
                        exerciseDetails.exercise_id,
                    );
                }
            } else {
                const path = this._getExercisePath(data);
                if (fs.existsSync(path) && fs.readdirSync(path).length !== 0) {
                    return new Err(new Error("Exercise already downloaded"));
                }
            }
        }
        const exerciseFolderPath = this._resources.getExercisesFolderPath();
        const exercisePath = path.join(
            exerciseFolderPath,
            organizationSlug,
            exerciseDetails.course_name,
            exerciseDetails.exercise_name,
        );
        this._pathToId.set(exercisePath, exerciseDetails.exercise_id);
        this._idToData.set(exerciseDetails.exercise_id, {
            checksum,
            course: exerciseDetails.course_name,
            deadline: exerciseDetails.deadline,
            id: exerciseDetails.exercise_id,
            status: ExerciseStatus.CLOSED,
            name: exerciseDetails.exercise_name,
            organization: organizationSlug,
            softDeadline: softDeadline,
        });
        this._updatePersistentData();
        return new Ok(exercisePath);
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

    public getExercisesByCourseName(courseName: string): LocalExerciseData[] {
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
        if (!editorPath) {
            return undefined;
        }
        return this.checkIfPathIsExercise(editorPath);
    }

    /**
     * Get the Exercise data for the currently open text editor
     */
    public getCurrentExerciseData(): Result<LocalExerciseData, Error> {
        const id = this.getCurrentExerciseId();
        if (!id) {
            return new Err(new Error("Currently open editor is not part of a TMC exercise"));
        }
        return this.getExerciseDataById(id);
    }

    /**
     * Checks if a given file is a part of a TMC exercise and returns its id if it is
     * @param filePath
     */
    public checkIfPathIsExercise(filePath: string): number | undefined {
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
     * Opens exercises to the workspace file.
     * @param id Exercise ID to open
     */
    public async openExercise(
        courseName: string,
        ...ids: number[]
    ): Promise<Result<{ id: number; status: UITypes.ExerciseStatus }[], Error>> {
        let results: { id: number; status: UITypes.ExerciseStatus }[] = [];

        const courseExercises = this.getExercisesByCourseName(courseName);

        if (isCorrectWorkspaceOpen(this._resources, courseName)) {
            const result = await this._handleWorkspaceChanges(true, courseExercises, ...ids);
            if (result.err) {
                return result;
            }
        }
        results = await this._setStatus(ExerciseStatus.CLOSED, ExerciseStatus.OPEN, ...ids);
        await this._updatePersistentData();
        return new Ok(results);
    }

    /**
     * Closes exercise in the workspace file.
     * @param id Exercise ID to close
     */
    public async closeExercise(
        courseName: string,
        ...ids: number[]
    ): Promise<Result<{ id: number; status: UITypes.ExerciseStatus }[], Error>> {
        let results: { id: number; status: UITypes.ExerciseStatus }[] = [];

        const courseExercises = this.getExercisesByCourseName(courseName);
        if (isCorrectWorkspaceOpen(this._resources, courseName)) {
            const result = await this._handleWorkspaceChanges(false, courseExercises, ...ids);
            if (result.err) {
                return result;
            }
        }
        results = await this._setStatus(ExerciseStatus.OPEN, ExerciseStatus.CLOSED, ...ids);

        await this._updatePersistentData();
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
                delSync(openPath, { force: true });
                this._pathToId.delete(openPath);
                this._idToData.delete(id);
            }
        }
        await this._updatePersistentData();
    }

    public getAllExercises(): LocalExerciseData[] {
        return Array.from(this._idToData.values());
    }

    public async setMissing(id: number): Promise<void> {
        const data = this._idToData.get(id);
        if (data) {
            data.status = ExerciseStatus.MISSING;
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

    private async _handleWorkspaceChanges(
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
        // allOpen.length > 0 && Logger.debug("Exercises with opened status:", ...allOpen);
        const toClose: vscode.Uri[] = [];
        const toOpen: vscode.Uri[] = [];

        const statusToCheck = handleAsOpen ? ExerciseStatus.CLOSED : ExerciseStatus.OPEN;
        ids.forEach((id) => {
            const data = this._idToData.get(id);
            if (data && data.status === statusToCheck) {
                const openPath = this._getExercisePath(data);
                const openAsUri = vscode.Uri.file(openPath);
                if (!fs.existsSync(openPath)) {
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
            this._verifyWorkspaceRootFile();
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
        return new Err(new Error("Failed to handle workspace changes."));
    }

    private async _setStatus(
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
                    await this.setMissing(id);
                    results.push({ id: data.id, status: "new" });
                    return;
                }
                data.status = newStatus;
                this._idToData.set(data.id, data);
                results.push({ id: data.id, status: uistatus });
            }
        });
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
     * Checks to make sure all the folders are in place,
     * should be run at startup before the watcher is initialized
     */
    private async _workspaceIntegrityCheck(): Promise<void> {
        const workspaceAndCourseName = vscode.workspace.name?.split(" ")[0];
        Logger.log(`Workspace integrity check for ${workspaceAndCourseName}`);
        if (
            workspaceAndCourseName &&
            isCorrectWorkspaceOpen(this._resources, workspaceAndCourseName)
        ) {
            const exercises = this.getExercisesByCourseName(workspaceAndCourseName);
            const openIds: number[] = exercises
                .filter((ex) => ex.status === ExerciseStatus.OPEN)
                .map((ex) => ex.id);
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
     * Verifies that .tmc/ file exists and its contents is correct.
     */
    private _verifyWorkspaceRootFile(): void {
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
