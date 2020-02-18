import * as del from "del";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";

import Resources from "../config/resources";
import Storage from "../config/storage";
import { ExerciseDetails, LocalExerciseData } from "./types";

/**
 * Helper class for creating unique and verbose folder paths to exercises and managing them.
 */
export default class WorkspaceManager {
    private readonly pathToId: Map<string, number>;
    private readonly idToData: Map<number, LocalExerciseData>;
    private readonly storage: Storage;
    private readonly resources: Resources;

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
            console.log(storedData);
            this.idToData = new Map(storedData.map((x) => ([x.id, x])));
            this.pathToId = new Map(storedData.map((x) => ([x.path, x.id])));
        } else {
            this.idToData = new Map();
            this.pathToId = new Map();
        }
    }

    /**
     * Creates a unique human-readable directory path for an exercise and persistently manages its relation
     * to exercise's actual id.
     * @param organizationSlug Organization slug used in the creation of exercise path
     * @param exerciseDetails Exercise details used in the creation of exercise path
     */
    public createExercisePath(organizationSlug: string, checksum: string, exerciseDetails: ExerciseDetails): string {
        const exerciseFolderPath = this.resources.tmcExercisesFolderPath;
        const { course_name, exercise_name, exercise_id } = exerciseDetails;
        const exercisePath = path.join(exerciseFolderPath, organizationSlug, course_name, exercise_name);
        this.pathToId.set(exercisePath, exercise_id);
        this.idToData.set(exercise_id, {
            checksum, course: exerciseDetails.course_name, id: exercise_id,
            organization: organizationSlug, path: exercisePath,
        });
        this.updatePersistentData();
        return exercisePath;
    }

    /**
     * Gets the matching exercise's data for the given path, if managed by this object.
     * @param exerciseFolder Path to exercise folder used for matching with the data
     */
    public getExerciseDataByPath(exerciseFolder: string): Result<LocalExerciseData, Error> {
        console.log(exerciseFolder);
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

    /**
     * Gets the matching exercise's ID for the given path, if managed by this object.
     * @param exerciseFolder Path to exercise folder used for matching with the id
     */
    public getExerciseIdByPath(exerciseFolder: string): Result<number, Error> {
        console.log(exerciseFolder);
        const id = this.pathToId.get(exerciseFolder);
        return (id !== undefined) ? new Ok(id) : new Err(new Error(`Exercise ID not found for ${exerciseFolder}`));
    }

    /**
     * Checks if a given file is a part of a TMC exercise and returns its id if it is
     * @param filePath
     */
    public getExercisePath(filePath: string): number | undefined {
        const exerciseFolderPath = this.resources.tmcExercisesFolderPath;
        const relation = path.relative(exerciseFolderPath, filePath);
        console.log(relation);
        if (relation.startsWith("..")) {
            return undefined;
        }
        const idResult = this.getExerciseIdByPath(
            path.join(exerciseFolderPath, ...relation.split(path.sep, 3).slice(0, 3)));

        if (idResult.err) {
            return undefined;
        }
        return idResult.val;
    }

    /**
     * Deletes an exercise folder from the workspace if present
     * @param exerciseId Exercise ID to delete
     */
    public deleteExercise(exerciseId: number): void {
        const exercisePath = this.idToData.get(exerciseId)?.path;
        if (exercisePath) {
            del.sync(exercisePath, { force: true });
            this.idToData.delete(exerciseId);
            this.pathToId.delete(exercisePath);
            this.updatePersistentData();
        }
    }

    private updatePersistentData() {
        this.storage.updateExerciseData(Array.from(this.idToData.values()));
    }
}
