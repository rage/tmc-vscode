import * as del from "del";
import * as fs from "fs-extra";
import * as path from "path";

import du = require("du");

import { Err, Ok, Result } from "ts-results";

import Resources from "../config/resources";
import Storage from "../config/storage";
import { ExerciseDetails } from "./types";
import { ExerciseStatus, LocalExerciseData } from "../config/types";
import WorkspaceWatcher from "./workspaceWatcher";
import Logger from "../utils/logger";

/**
 * Class for managing, opening and closing of exercises on disk.
 */
export default class WorkspaceManager {
    private readonly pathToId: Map<string, number>;
    private readonly idToData: Map<number, LocalExerciseData>;
    private readonly storage: Storage;
    private readonly resources: Resources;
    private readonly logger: Logger;

    // Data for the workspace filesystem event watcher
    private readonly watcher: WorkspaceWatcher;

    /**
     * Creates a new instance of the WorkspaceManager class.
     * @param storage Storage object for persistent data storing
     * @param resources Resources instance for constructing the exercise path
     */
    constructor(storage: Storage, resources: Resources, logger: Logger) {
        this.storage = storage;
        this.resources = resources;
        this.logger = logger;
        const storedData = this.storage.getExerciseData();
        if (storedData) {
            this.idToData = new Map(storedData.map((x) => [x.id, x]));
            this.pathToId = new Map(storedData.map((x) => [this.getOpenPath(x), x.id]));
        } else {
            this.idToData = new Map();
            this.pathToId = new Map();
        }
        this.workspaceIntegrityCheck();
        this.watcher = new WorkspaceWatcher(this, resources, logger);
        this.watcher.start();
    }

    public updateExerciseData(
        id: number,
        softDeadline: string | null,
        hardDeadline: string | null,
        latestChecksum: string,
    ): void {
        const data = this.idToData.get(id);
        if (data) {
            data.deadline = hardDeadline;
            data.softDeadline = softDeadline;
            if (data.checksum !== latestChecksum) {
                data.updateAvailable = true;
            }
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
            updateAvailable: false,
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
        this.watcher.stop();
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
    public openExercise(...ids: number[]): Result<string, Error>[] {
        const results: Result<string, Error>[] = [];

        this.watcher.stop();

        for (const id of ids) {
            const data = this.idToData.get(id);
            if (data && data.status === ExerciseStatus.CLOSED) {
                if (!fs.existsSync(this.getClosedPath(id))) {
                    this.setMissing(id);
                    results.push(
                        new Err(new Error(`Exercise data missing: ${this.getClosedPath(id)}`)),
                    );
                    continue;
                }
                const openPath = this.getOpenPath(data);
                fs.mkdirSync(path.resolve(openPath, ".."), { recursive: true });
                try {
                    fs.renameSync(this.getClosedPath(id), openPath);
                } catch (err) {
                    results.push(
                        new Err(
                            new Error(
                                `Folder move operation failed: fs.renameSync(${this.getClosedPath(
                                    id,
                                )}, ${openPath})`,
                            ),
                        ),
                    );
                    continue;
                }
                this.watcher.watch(data);
                data.status = ExerciseStatus.OPEN;
                this.idToData.set(id, data);
                results.push(new Ok(openPath));
            } else if (!data) {
                results.push(new Err(new Error(`Invalid ID: ${id}`)));
                continue;
            }
        }
        this.updatePersistentData();
        this.watcher.start();
        return results;
    }

    /**
     * Closes exercise by moving it away from workspace.
     * @param id Exercise ID to close
     */
    public closeExercise(...ids: number[]): Result<void, Error>[] {
        const results: Result<void, Error>[] = [];

        this.watcher.stop();

        for (const id of ids) {
            const data = this.idToData.get(id);
            if (data && data.status === ExerciseStatus.OPEN) {
                const openPath = this.getOpenPath(data);
                if (!fs.existsSync(openPath)) {
                    this.setMissing(id);
                    results.push(new Err(new Error(`Exercise data missing: ${openPath}`)));
                    continue;
                }
                del.sync(this.getClosedPath(id), { force: true });
                try {
                    fs.renameSync(openPath, this.getClosedPath(id));
                } catch (err) {
                    results.push(
                        new Err(
                            new Error(
                                `Folder move operation failed: fs.renameSync(${openPath}, ${this.getClosedPath(
                                    id,
                                )})`,
                            ),
                        ),
                    );
                    continue;
                }
                this.watcher.unwatch(data);
                data.status = ExerciseStatus.CLOSED;
                this.idToData.set(id, data);
                results.push(Ok.EMPTY);
            } else if (!data) {
                results.push(new Err(new Error(`Invalid ID: ${id}`)));
                continue;
            }
        }
        this.updatePersistentData();
        this.watcher.start();
        return results;
    }

    /**
     * Deletes exercise from disk if present and clears all data related to it.
     * @param exerciseId Exercise ID to delete
     */
    public deleteExercise(...ids: number[]): void {
        this.watcher.stop();
        for (const id of ids) {
            const data = this.idToData.get(id);
            if (data) {
                this.watcher.unwatch(data);
                const openPath = this.getOpenPath(data);
                del.sync(openPath, { force: true });
                del.sync(this.getClosedPath(id), { force: true });
                this.pathToId.delete(openPath);
                this.idToData.delete(id);
            }
        }
        this.updatePersistentData();
        this.watcher.start();
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

    public isExerciseOpen(id: number): boolean {
        const data = this.idToData.get(id);
        if (data) {
            return data.status === ExerciseStatus.OPEN;
        }
        return false;
    }

    public exerciseExists(id: number): boolean {
        const data = this.idToData.get(id);
        if (data) {
            return data.status !== ExerciseStatus.MISSING;
        }
        return false;
    }

    public restartWatcher(): void {
        this.watcher.stop();
        this.watcher.start();
    }

    public getExercisePathById(id: number): Result<string, Error> {
        const data = this.idToData.get(id);
        if (!data) {
            return new Err(new Error("Invalid exercise ID"));
        }
        switch (data.status) {
            case ExerciseStatus.OPEN:
                return new Ok(this.getOpenPath(data));
            case ExerciseStatus.CLOSED:
                return new Ok(this.getClosedPath(data.id));
            default:
                return new Err(new Error("Exercise data missing"));
        }
    }

    private updatePersistentData(): void {
        this.storage.updateExerciseData(Array.from(this.idToData.values()));
    }

    private getClosedPath(id: number): string {
        return path.join(this.resources.getClosedExercisesFolderPath(), id.toString());
    }

    private getOpenPath(exerciseData: LocalExerciseData): string {
        return path.join(
            this.resources.getExercisesFolderPath(),
            exerciseData.organization,
            exerciseData.course,
            exerciseData.name,
        );
    }

    /**
     * Checks to make sure all the folders are in place,
     * should be run at startup before the watcher is initialized
     */
    private workspaceIntegrityCheck(): void {
        this.logger.log(
            "WorkspaceManager - Checking that all exercise folders and their status are in place.",
        );
        for (const data of Array.from(this.idToData.values())) {
            const isOpen = fs.existsSync(this.getOpenPath(data));
            const isClosed = fs.existsSync(this.getClosedPath(data.id));
            if (isOpen) {
                data.status = ExerciseStatus.OPEN;
                if (isClosed) {
                    del.sync(this.getClosedPath(data.id), { force: true });
                }
            } else if (isClosed) {
                data.status = ExerciseStatus.CLOSED;
            } else {
                data.status = ExerciseStatus.MISSING;
            }
            this.idToData.set(data.id, data);
        }
        this.updatePersistentData();
    }
}
