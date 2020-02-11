import * as path from "path";
import { Err, Ok, Result } from "ts-results";

import Resources from "../config/resources";
import Storage from "../config/storage";
import { ExerciseDetails } from "./types";

/**
 * Helper class for creating unique and verbose folder paths to exercises and managing them.
 */
export default class ExerciseManager {
    private readonly pathToId: Map<string, number>;
    private readonly idToPath: Map<number, string>;
    private readonly storage: Storage;
    private readonly resources: Resources;

    /**
     * Creates a new instance of the ExerciseManager class.
     * @param storage Storage object for persistent data storing
     * @param resources Resources instance for constructing the exercise path
     */
    constructor(storage: Storage, resources: Resources) {
        this.storage = storage;
        this.resources = resources;
        const storedData = this.storage.getExerciseData();
        if (storedData) {
            this.pathToId = new Map(storedData.pathToId);
            this.idToPath = new Map(storedData.idToPath);
        } else {
            this.pathToId = new Map();
            this.idToPath = new Map();
        }
    }

    /**
     * Creates a unique human-readable directory path for an exercise and persistently manages its relation
     * to exercise's actual id.
     * @param organizationSlug Organization slug used in the creation of exercise path
     * @param exerciseDetails Exercise details used in the creation of exercise path
     */
    public createExercisePath(organizationSlug: string, exerciseDetails: ExerciseDetails): string {
        const exerciseFolderPath = this.resources.tmcExercisesFolderPath;
        const { course_name, exercise_name, exercise_id } = exerciseDetails;
        const exercisePath = path.join(exerciseFolderPath, organizationSlug, course_name, exercise_name);
        this.pathToId.set(exercisePath, exercise_id);
        this.idToPath.set(exercise_id, exercisePath);
        this.storage.updateExerciseData({
            idToPath: Array.from(this.idToPath.entries()),
            pathToId: Array.from(this.pathToId.entries()),
        });
        return exercisePath;
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
     * Gets the matching exercise folder path for the given ID, if managed by this object.
     * @param exerciseId Exercise ID used for matching with the path
     */
    public getPathByExerciseId(exerciseId: number): Result<string, Error> {
        const exercisePath = this.idToPath.get(exerciseId);
        console.log(exercisePath);
        return (exercisePath !== undefined) ? new Ok(exercisePath) : new Err(new Error(`Exercise path not found for ${exerciseId}`));
    }
}
