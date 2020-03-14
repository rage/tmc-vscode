import * as del from "del";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { Err, Ok, Result } from "ts-results";

import Resources from "../config/resources";
import Storage from "../config/storage";
import { ExerciseDetails, LocalExerciseData } from "./types";

/**
 * Class for managing, opening and closing of exercises on disk.
 */
export default class WorkspaceManager {
    private readonly pathToId: Map<string, number>;
    private readonly idToData: Map<number, LocalExerciseData>;
    private readonly storage: Storage;
    private readonly resources: Resources;

    // Data for the workspace filesystem event watcher
    private readonly watcherTree: Map<string, Map<string, Set<string>>> = new Map();

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
            this.pathToId = new Map(storedData.map((x) => [x.path, x.id]));
        } else {
            this.idToData = new Map();
            this.pathToId = new Map();
        }
        this.startWatcher();
    }

    /**
     * Creates a unique human-readable directory path for an exercise and persistently manages its relation
     * to exercise's actual id.
     * @param organizationSlug Organization slug used in the creation of exercise path
     * @param exerciseDetails Exercise details used in the creation of exercise path
     */
    public createExerciseDownloadPath(
        organizationSlug: string,
        checksum: string,
        exerciseDetails: ExerciseDetails,
    ): Result<string, Error> {
        if (this.idToData.has(exerciseDetails.exercise_id)) {
            return new Err(new Error("Exercise already downloaded."));
        }
        const exerciseFolderPath = this.resources.tmcExercisesFolderPath;
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
            isOpen: false,
            name: exerciseDetails.exercise_name,
            organization: organizationSlug,
            path: exercisePath,
        });
        this.updatePersistentData();
        return new Ok(this.getClosedPath(exerciseDetails.exercise_id));
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
    public getExercisePath(filePath: string): number | undefined {
        const exerciseFolderPath = this.resources.tmcExercisesFolderPath;
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
     * Opens exercise by moving it to workspace folder.
     * @param id Exercise ID to open
     * @param clearFolder Force remove the folder and it's contents, before opening from closed path.
     */
    public openExercise(id: number, clearFolder?: boolean): Result<string, Error> {
        const data = this.idToData.get(id);
        if (data && !data.isOpen) {
            fs.mkdirSync(path.resolve(data.path, ".."), { recursive: true });
            if (clearFolder) {
                del.sync(data.path, { force: true });
            }
            this.addToWatcherTree(data);
            try {
                fs.renameSync(this.getClosedPath(id), data.path);
            } catch (err) {
                this.removeFromWatcherTree(data);
                return new Err(new Error("Folder move operation failed."));
            }
            data.isOpen = true;
            this.idToData.set(id, data);
            this.updatePersistentData();
            return new Ok(data.path);
        } else {
            return new Err(new Error("Invalid ID or unable to open."));
        }
    }

    /**
     * Closes exercise by moving it away from workspace.
     * @param id Exercise ID to close
     */
    public closeExercise(id: number): Result<void, Error> {
        const data = this.idToData.get(id);
        if (data && data.isOpen) {
            fs.renameSync(data.path, this.getClosedPath(id));
            data.isOpen = false;
            this.idToData.set(id, data);
            this.removeFromWatcherTree(data);
            this.updatePersistentData();
            return Ok.EMPTY;
        } else {
            return new Err(new Error("Invalid ID or unable to close."));
        }
    }

    /**
     * Deletes exercise from disk if present and clears all data related to it.
     * @param exerciseId Exercise ID to delete
     */
    public deleteExercise(exerciseId: number): void {
        const workspacePath = this.idToData.get(exerciseId)?.path;
        if (workspacePath) {
            del.sync(workspacePath, { force: true });
        }

        const closedPath = this.getClosedPath(exerciseId);
        if (closedPath) {
            del.sync(closedPath, { force: true });
        }

        this.clearExerciseData(exerciseId);
    }

    private clearExerciseData(id: number): void {
        const exercisePath = this.idToData.get(id)?.path;
        if (exercisePath) {
            this.idToData.delete(id);
            this.pathToId.delete(exercisePath);
            this.updatePersistentData();
        }
    }

    private updatePersistentData(): void {
        this.storage.updateExerciseData(Array.from(this.idToData.values()));
    }

    private getClosedPath(id: number): string {
        return path.join(this.resources.tmcClosedExercisesFolderPath, id.toString());
    }

    private addToWatcherTree({ organization, course, name }: LocalExerciseData): void {
        if (!this.watcherTree.has(organization)) {
            this.watcherTree.set(organization, new Map());
        }
        if (!this.watcherTree.get(organization)?.has(course)) {
            this.watcherTree.get(organization)?.set(course, new Set());
        }
        this.watcherTree
            .get(organization)
            ?.get(course)
            ?.add(name);
    }

    private removeFromWatcherTree({
        organization,
        course,
        name,
        path: exercisePath,
    }: LocalExerciseData): void {
        if (this.watcherTree.get(organization)?.has(course)) {
            this.watcherTree
                .get(organization)
                ?.get(course)
                ?.delete(name);
            if (this.watcherTree.get(organization)?.get(course)?.size === 0) {
                this.watcherTree.get(organization)?.delete(course);
                if (this.watcherTree.get(organization)?.size === 0) {
                    this.watcherTree.delete(organization);
                }
            }
            this.watcherAction(exercisePath);
        }
    }

    private initializeWatcherData(): void {
        this.watcherTree.clear();
        for (const data of this.idToData.values()) {
            if (data.isOpen) {
                this.addToWatcherTree(data);
            }
        }
    }

    private watcherAction(targetPath: string): void {
        const relation = path
            .relative(this.resources.tmcExercisesFolderPath, targetPath)
            .toString()
            .split(path.sep, 3);
        if (relation[0] === "..") {
            return;
        }
        if (relation.length > 0 && !this.watcherTree.has(relation[0])) {
            del.sync(path.join(this.resources.tmcExercisesFolderPath, relation[0]), {
                force: true,
            });
            return;
        }
        if (relation.length > 1 && !this.watcherTree.get(relation[0])?.has(relation[1])) {
            del.sync(path.join(this.resources.tmcExercisesFolderPath, relation[0], relation[1]), {
                force: true,
            });
            return;
        }
        if (
            relation.length > 2 &&
            !this.watcherTree
                .get(relation[0])
                ?.get(relation[1])
                ?.has(relation[2])
        ) {
            del.sync(path.join(this.resources.tmcExercisesFolderPath, ...relation), {
                force: true,
            });
            return;
        }
    }

    private startWatcher(): void {
        this.initializeWatcherData();
        const watcher = vscode.workspace.createFileSystemWatcher("**", false, true, true);
        watcher.onDidCreate((x) => {
            if (x.scheme === "file") {
                this.watcherAction(x.path);
            }
        });
    }
}
