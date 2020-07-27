import { sync as delSync } from "del";
import du = require("du");
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { WORKSPACE_SETTINGS } from "../config/constants";
import Resources from "../config/resources";
import Storage from "../config/storage";
import { ExerciseStatus, LocalExerciseData } from "../config/types";
import * as UITypes from "../ui/types";
import { isCorrectWorkspaceOpen, Logger } from "../utils";

import { ExerciseDetails } from "./types";
import { showNotification } from "./vscode";
import WorkspaceWatcher from "./workspaceWatcher";

/**
 * Class for managing, opening and closing of exercises on disk.
 */
export default class WorkspaceManager {
    private readonly pathToId: Map<string, number>;
    private readonly idToData: Map<number, LocalExerciseData>;
    private readonly storage: Storage;
    private readonly resources: Resources;

    // Data for the workspace filesystem event watcher
    private readonly watcher: WorkspaceWatcher;

    /**
     * Creates a new instance of the WorkspaceManager class.
     * @param storage Storage object for persistent data storing
     * @param resources Resources instance for constructing the exercise path
     */
    constructor(storage: Storage, resources: Resources) {
        this.storage = storage;
        this.resources = resources;
        const storedData = this.storage.getExerciseData();
        if (storedData) {
            this.idToData = new Map(storedData.map((x) => [x.id, x]));
            this.pathToId = new Map(storedData.map((x) => [this.getExercisePath(x), x.id]));
        } else {
            this.idToData = new Map();
            this.pathToId = new Map();
        }
        this.watcher = new WorkspaceWatcher(resources);
    }

    public async initialize(): Promise<void> {
        Logger.log("Initializing workspace");
        await this.workspaceIntegrityCheck();
        this.watcher.start();
    }

    public updateExerciseData(
        id: number,
        softDeadline: string | null,
        hardDeadline: string | null,
    ): void {
        const data = this.idToData.get(id);
        if (data) {
            data.deadline = hardDeadline;
            data.softDeadline = softDeadline;
            this.idToData.set(id, data);
            this.updatePersistentData();
        }
    }

    public updateExercisesStatus(id: number, status: ExerciseStatus): void {
        const data = this.idToData.get(id);
        if (data) {
            data.status = status;
            this.idToData.set(id, data);
            this.updatePersistentData();
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
        if (this.idToData.has(exerciseDetails.exercise_id)) {
            const data = this.idToData.get(exerciseDetails.exercise_id);
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
                return new Err(new Error("Exercise already downloaded"));
            }
        }
        const exerciseFolderPath = this.resources.getExercisesFolderPath();
        const exercisePath = path.join(
            exerciseFolderPath,
            organizationSlug,
            exerciseDetails.course_name,
            exerciseDetails.exercise_name,
        );
        this.pathToId.set(exercisePath, exerciseDetails.exercise_id);
        this.idToData.set(exerciseDetails.exercise_id, {
            checksum,
            course: exerciseDetails.course_name,
            deadline: exerciseDetails.deadline,
            id: exerciseDetails.exercise_id,
            status: ExerciseStatus.CLOSED,
            name: exerciseDetails.exercise_name,
            organization: organizationSlug,
            softDeadline: softDeadline,
        });
        this.updatePersistentData();
        return new Ok(exercisePath);
    }

    /**
     * Gets the matching exercise's data for the given path, if managed by this object.
     * @param exerciseFolder Path to exercise folder used for matching with the data
     */
    public getExerciseDataByPath(exerciseFolder: string): Result<LocalExerciseData, Error> {
        const id = this.pathToId.get(exerciseFolder);
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
        const data = this.idToData.get(id);
        if (!data) {
            return new Err(new Error(`Exercise data missing for ${id}`));
        }
        return new Ok(data);
    }

    public getExercisesByCourseName(courseName: string): LocalExerciseData[] {
        const exercises: LocalExerciseData[] = [];
        for (const data of this.idToData.values()) {
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
        const id = this.pathToId.get(exerciseFolder);
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
        const exerciseFolderPath = this.resources.getExercisesFolderPath();
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
            if (fs.existsSync(newPath) && (await du(oldPath)) < (await du(newPath))) {
                return new Ok(false);
            }
            try {
                fs.removeSync(newPath);
            } catch (err2) {
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

        if (isCorrectWorkspaceOpen(this.resources, courseName)) {
            const result = await this.handleWorkspaceChanges(true, courseExercises, ...ids);
            if (result.err) {
                return new Err(
                    new Error(
                        `Something went wrong while trying to open exercises. ${result.val.message}`,
                    ),
                );
            }
            await vscode.commands.executeCommand("workbench.files.action.collapseExplorerFolders");
        }
        results = await this.setStatus(ExerciseStatus.CLOSED, ExerciseStatus.OPEN, ...ids);
        await this.updatePersistentData();
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
        if (isCorrectWorkspaceOpen(this.resources, courseName)) {
            const result = await this.handleWorkspaceChanges(false, courseExercises, ...ids);
            if (result.err) {
                return new Err(
                    new Error(
                        `Something went wrong while trying to close exercises. ${result.val.message}`,
                    ),
                );
            }
        }
        results = await this.setStatus(ExerciseStatus.OPEN, ExerciseStatus.CLOSED, ...ids);

        await this.updatePersistentData();
        return new Ok(results);
    }

    private async setStatus(
        oldStatus: ExerciseStatus,
        newStatus: ExerciseStatus,
        ...ids: number[]
    ): Promise<Array<{ id: number; status: UITypes.ExerciseStatus }>> {
        const results: Array<{ id: number; status: UITypes.ExerciseStatus }> = [];
        const uistatus = newStatus === ExerciseStatus.OPEN ? "opened" : "closed";
        ids.forEach(async (id) => {
            const data = this.idToData.get(id);
            if (data && data.status === oldStatus) {
                if (!fs.existsSync(this.getExercisePath(data))) {
                    await this.setMissing(id);
                    results.push({ id: data.id, status: "new" });
                    return;
                }
                data.status = newStatus;
                this.idToData.set(data.id, data);
                results.push({ id: data.id, status: uistatus });
            }
        });
        return results;
    }

    private async handleWorkspaceChanges(
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
            .map((ex) => vscode.Uri.file(this.getExercisePath(ex)));

        const toClose: vscode.Uri[] = [];
        const toOpen: vscode.Uri[] = [];

        const statusToCheck = handleAsOpen ? ExerciseStatus.CLOSED : ExerciseStatus.OPEN;
        ids.forEach((id) => {
            const data = this.idToData.get(id);
            if (data && data.status === statusToCheck) {
                const openPath = this.getExercisePath(data);
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

        if (currentlyOpenFolders.length === 0 || currentlyOpenFolders[0].name !== ".tmc") {
            Logger.warn("The .tmc folder is not set as root folder.");
            this.watcher.verifyWorkspaceRootFile();
            allOpen.push(
                vscode.Uri.file(path.join(this.resources.getWorkspaceFolderPath(), ".tmc")),
            );
            tmcFolderAsRoot = false;
        }

        let toOpenAsWorkspaceArg = [];
        if (!handleAsOpen) {
            toOpenAsWorkspaceArg = _.differenceBy(allOpen, toClose, "path");
        } else {
            toOpenAsWorkspaceArg = _.unionBy(allOpen, toOpen, "path");
        }
        toOpenAsWorkspaceArg = toOpenAsWorkspaceArg.sort().map((e) => ({ uri: e }));

        let success = true;
        const start = tmcFolderAsRoot ? 1 : 0;
        const remove = currentlyOpenFolders.length - start;
        if (!tmcFolderAsRoot) {
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            showNotification("The workspace first folder is not .tmc, fixing issue.");
        }

        success = vscode.workspace.updateWorkspaceFolders(
            start,
            remove > 0 ? remove : null,
            ...toOpenAsWorkspaceArg,
        );

        return success ? Ok.EMPTY : new Err(new Error("Failed to handle workspace changes."));
    }

    /**
     * Deletes exercise from disk if present and clears all data related to it.
     * @param exerciseId Exercise ID to delete
     */
    public async deleteExercise(...ids: number[]): Promise<void> {
        for (const id of ids) {
            const data = this.idToData.get(id);
            if (data) {
                const openPath = this.getExercisePath(data);
                delSync(openPath, { force: true });
                this.pathToId.delete(openPath);
                this.idToData.delete(id);
            }
        }
        await this.updatePersistentData();
    }

    public getAllExercises(): LocalExerciseData[] {
        return Array.from(this.idToData.values());
    }

    public async setMissing(id: number): Promise<void> {
        const data = this.idToData.get(id);
        if (data) {
            data.status = ExerciseStatus.MISSING;
            this.idToData.set(id, data);
            await this.updatePersistentData();
        }
    }

    public getExercisePathById(id: number): Result<string, Error> {
        const data = this.idToData.get(id);
        if (!data) {
            return new Err(new Error("Invalid exercise ID"));
        }
        const path = this.getExercisePath(data);
        if (!fs.existsSync(path)) {
            new Err(new Error(`Exercise data missing ${path}`));
        }
        return new Ok(path);
    }

    private getExercisePath(exerciseData: LocalExerciseData): string {
        return path.join(
            this.resources.getExercisesFolderPath(),
            exerciseData.organization,
            exerciseData.course,
            exerciseData.name,
        );
    }

    private async updatePersistentData(): Promise<void> {
        return this.storage.updateExerciseData(Array.from(this.idToData.values()));
    }

    public createWorkspaceFile(courseName: string): void {
        const tmcWorkspaceFilePath = path.join(
            this.resources.getWorkspaceFolderPath(),
            courseName + ".code-workspace",
        );
        if (!fs.existsSync(tmcWorkspaceFilePath)) {
            fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS));
            Logger.log(`Created tmc workspace file at ${tmcWorkspaceFilePath}`);
        }
    }

    /**
     * Checks to make sure all the folders are in place,
     * should be run at startup before the watcher is initialized
     */
    private async workspaceIntegrityCheck(): Promise<void> {
        const workspaceAndCourseName = vscode.workspace.name?.split(" ")[0];
        Logger.log(`Workspace integrity check for ${workspaceAndCourseName}`);
        if (
            workspaceAndCourseName &&
            isCorrectWorkspaceOpen(this.resources, workspaceAndCourseName)
        ) {
            const exercises = this.getExercisesByCourseName(workspaceAndCourseName);
            const openIds: number[] = exercises
                .filter((ex) => ex.status === ExerciseStatus.OPEN)
                .map((ex) => ex.id);
            await this.openExercise(workspaceAndCourseName, ...openIds);
        }
    }
}
