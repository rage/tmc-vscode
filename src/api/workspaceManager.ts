import { sync as delSync } from "del";
import du = require("du");
import * as fs from "fs-extra";
import * as _ from "lodash";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import * as vscode from "vscode";

import Resources from "../config/resources";
import Settings from "../config/settings";
import Storage from "../config/storage";
import { ExerciseStatus, LocalExerciseData } from "../config/types";
import { UIExerciseStatus } from "../ui/types";
import { isCorrectWorkspaceOpen } from "../utils";

import { ExerciseDetails } from "./types";

/**
 * Class for managing, opening and closing of exercises on disk.
 */
export default class WorkspaceManager {
    private readonly pathToId: Map<string, number>;
    private readonly idToData: Map<number, LocalExerciseData>;
    private readonly storage: Storage;
    private readonly resources: Resources;
    private readonly settings: Settings;

    // Data for the workspace filesystem event watcher
    // private readonly watcher: WorkspaceWatcher;

    /**
     * Creates a new instance of the WorkspaceManager class.
     * @param storage Storage object for persistent data storing
     * @param resources Resources instance for constructing the exercise path
     */
    constructor(storage: Storage, resources: Resources, settings: Settings) {
        this.storage = storage;
        this.resources = resources;
        this.settings = settings;
        const storedData = this.storage.getExerciseData();
        if (storedData) {
            this.idToData = new Map(storedData.map((x) => [x.id, x]));
            this.pathToId = new Map(storedData.map((x) => [this.getExercisePath(x), x.id]));
        } else {
            this.idToData = new Map();
            this.pathToId = new Map();
        }
        this.workspaceIntegrityCheck();
        // this.watcher = new WorkspaceWatcher(this, resources);
        // this.watcher.start();
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
    public createExerciseDownloadPath(
        softDeadline: string | null,
        organizationSlug: string,
        checksum: string,
        exerciseDetails: ExerciseDetails,
    ): Result<string, Error> {
        if (this.idToData.has(exerciseDetails.exercise_id)) {
            const data = this.idToData.get(exerciseDetails.exercise_id);
            if (!data) {
                return new Err(new Error("Data integrity error"));
            }
            if (data.status === ExerciseStatus.MISSING) {
                this.deleteExercise(exerciseDetails.exercise_id);
            } else if (data.checksum !== checksum) {
                if (data.status === ExerciseStatus.OPEN) {
                    this.closeExercise(exerciseDetails.exercise_id);
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
     * Checks if a given file is a part of a TMC exercise and returns its id if it is
     * @param filePath
     */
    public checkExerciseIdByPath(filePath: string): number | undefined {
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
     * Opens exercise by moving it to workspace folder.
     * @param id Exercise ID to open
     */
    public async openExercise(
        ...ids: number[]
    ): Promise<Result<{ id: number; status: UIExerciseStatus }, Error>[]> {
        const results: Result<{ id: number; status: UIExerciseStatus }, Error>[] = [];
        const data = this.idToData.get(ids[0]);
        if (!data) {
            results.push(new Err(new Error(`Invalid ID: ${ids[0]}`)));
            return results;
        }

        if (isCorrectWorkspaceOpen(this.resources, data.course)) {
            const currentlyOpenFolders = vscode.workspace.workspaceFolders;
            if (!currentlyOpenFolders) {
                // User closed all folders manually?
                results.push(
                    new Err(new Error("No exercises or the root folder .tmc open in workspace")),
                );
                return results;
            }
            if (currentlyOpenFolders[0].name === ".tmc") {
                // Return error?
            }

            const courseExercises = this.getExercisesByCourseName(data.course);
            const dataIds: LocalExerciseData[] = [];
            const allToOpen: vscode.Uri[] = courseExercises
                .filter((ex) => ex.status === ExerciseStatus.OPEN)
                .map((ex) => vscode.Uri.file(this.getExercisePath(ex)));
            ids.forEach((id) => {
                const data = this.idToData.get(id);
                if (data && data.status === ExerciseStatus.CLOSED) {
                    const openPath = this.getExercisePath(data);
                    if (!fs.existsSync(openPath)) {
                        this.setMissing(id);
                        results.push(new Ok({ id: data.id, status: "new" }));
                        return;
                    }
                    dataIds.push(data);
                    allToOpen.push(vscode.Uri.file(openPath));
                }
            });

            const toOpenAsWorkspaceArg = allToOpen.sort().map((e) => ({ uri: e }));
            const success = vscode.workspace.updateWorkspaceFolders(
                1,
                currentlyOpenFolders.length - 1,
                ...toOpenAsWorkspaceArg,
            );

            if (success) {
                dataIds.forEach((data) => {
                    data.status = ExerciseStatus.OPEN;
                    this.idToData.set(data.id, data);
                    results.push(new Ok({ id: data.id, status: "opened" }));
                });
            } else {
                results.push(new Err(new Error("Failed to open exercises in workspace.")));
            }
        } else {
            ids.forEach((id) => {
                const data = this.idToData.get(id);
                if (data && data.status === ExerciseStatus.CLOSED) {
                    const openPath = this.getExercisePath(data);
                    if (!fs.existsSync(openPath)) {
                        this.setMissing(id);
                        results.push(new Ok({ id: data.id, status: "new" }));
                        return;
                    }
                    data.status = ExerciseStatus.OPEN;
                    this.idToData.set(data.id, data);
                    results.push(new Ok({ id: data.id, status: "opened" }));
                }
            });
        }
        await this.updatePersistentData();
        return results;
    }

    /**
     * Closes exercise by moving it away from workspace.
     * @param id Exercise ID to close
     */
    public async closeExercise(
        ...ids: number[]
    ): Promise<Result<{ id: number; status: UIExerciseStatus }, Error>[]> {
        const results: Result<{ id: number; status: UIExerciseStatus }, Error>[] = [];
        const data = this.idToData.get(ids[0]);
        if (!data) {
            results.push(new Err(new Error(`Invalid ID: ${ids[0]}`)));
            return results;
        }

        if (isCorrectWorkspaceOpen(this.resources, data.course)) {
            const currentlyOpenFolders = vscode.workspace.workspaceFolders;
            if (!currentlyOpenFolders) {
                // User closed all folders manually?
                results.push(
                    new Err(new Error("No exercises or the root folder .tmc open in workspace")),
                );
                return results;
            }
            if (currentlyOpenFolders[0].name === ".tmc") {
                // Return error?
            }

            const courseExercises = this.getExercisesByCourseName(data.course);
            const dataIds: LocalExerciseData[] = [];
            const allOpen: vscode.Uri[] = courseExercises
                .filter((ex) => ex.status === ExerciseStatus.OPEN)
                .map((ex) => vscode.Uri.file(this.getExercisePath(ex)));

            const toClose: vscode.Uri[] = [];
            ids.forEach((id) => {
                const data = this.idToData.get(id);
                if (data && data.status === ExerciseStatus.OPEN) {
                    const openPath = this.getExercisePath(data);
                    if (!fs.existsSync(openPath)) {
                        this.setMissing(id);
                        results.push(new Ok({ id: data.id, status: "new" }));
                        return;
                    }
                    dataIds.push(data);
                    toClose.push(vscode.Uri.file(openPath));
                }
            });

            const toOpen = _.differenceBy(allOpen, toClose, "path");

            const toOpenAsWorkspaceArg = toOpen.sort().map((e) => ({ uri: e }));
            const success = vscode.workspace.updateWorkspaceFolders(
                1,
                currentlyOpenFolders.length - 1,
                ...toOpenAsWorkspaceArg,
            );

            if (success) {
                dataIds.forEach((data) => {
                    data.status = ExerciseStatus.CLOSED;
                    this.idToData.set(data.id, data);
                    results.push(new Ok({ id: data.id, status: "closed" }));
                });
            } else {
                results.push(new Err(new Error("Failed to open exercises in workspace.")));
            }
        } else {
            ids.forEach((id) => {
                const data = this.idToData.get(id);
                if (data && data.status === ExerciseStatus.OPEN) {
                    const openPath = this.getExercisePath(data);
                    if (!fs.existsSync(openPath)) {
                        this.setMissing(id);
                        results.push(new Ok({ id: data.id, status: "new" }));
                        return;
                    }
                    data.status = ExerciseStatus.CLOSED;
                    this.idToData.set(data.id, data);
                    results.push(new Ok({ id: data.id, status: "closed" }));
                }
            });
        }
        await this.updatePersistentData();
        return results;
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

    public setMissing(id: number): void {
        const data = this.idToData.get(id);
        if (data) {
            data.status = ExerciseStatus.MISSING;
            this.idToData.set(id, data);
            this.updatePersistentData();
        }
    }

    // public isExerciseOpen(id: number): boolean {
    //     const data = this.idToData.get(id);
    //     if (data) {
    //         return data.status === ExerciseStatus.OPEN;
    //     }
    //     return false;
    // }

    /**
     * ExerciseStatus is not missing.
     */
    public exerciseExists(id: number): boolean {
        const data = this.idToData.get(id);
        if (data) {
            return data.status !== ExerciseStatus.MISSING;
        }
        return false;
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

    // public getClosedPath(id: number): string {
    //     return path.join(this.resources.getClosedExercisesFolderPath(), id.toString());
    // }

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

    /**
     * Checks to make sure all the folders are in place,
     * should be run at startup before the watcher is initialized
     */
    private workspaceIntegrityCheck(): void {
        const workspaceAndCourseName = vscode.workspace.name?.split(" ")[0];
        if (
            workspaceAndCourseName &&
            isCorrectWorkspaceOpen(this.resources, workspaceAndCourseName)
        ) {
            const exercises = this.getExercisesByCourseName(workspaceAndCourseName);
            const openIds: number[] = exercises
                .filter((ex) => ex.status === ExerciseStatus.OPEN)
                .map((ex) => ex.id);
            this.openExercise(...openIds);
        }
    }
}
