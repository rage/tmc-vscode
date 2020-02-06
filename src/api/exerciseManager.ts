import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import Resources from "../config/resources";
import Storage from "../config/storage";

export default class ExerciseManager {
    private readonly pathToId: Map<string, number>;
    private readonly idToPath: Map<number, string>;
    private readonly storage: Storage;
    private readonly resources: Resources;

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

    public createExercise(organizationSlug: string, courseName: string,
                          exerciseName: string, exerciseID: number): string {
        const exerciseFolderPath = this.resources.tmcExercisesFolderPath;
        const exercisePath = path.join(exerciseFolderPath, organizationSlug, courseName, exerciseName);
        this.pathToId.set(exercisePath, exerciseID);
        this.idToPath.set(exerciseID, exercisePath);
        this.storage.updateExerciseData({idToPath: Array.from(this.idToPath.entries()),
                                         pathToId: Array.from(this.pathToId.entries()),
        });
        return exercisePath;
    }

    public getExerciseIdByPath(exercisePath: string): Result<number, Error> {
        console.log(exercisePath);
        const id = this.pathToId.get(exercisePath);
        return (id !== undefined) ? new Ok(id) : new Err(new Error("undefined"));
    }

    public getPathByExerciseId(id: number): Result<string, Error> {
        const exercisePath = this.idToPath.get(id);
        console.log(exercisePath);
        return (exercisePath !== undefined) ? new Ok(exercisePath) : new Err(new Error());
    }

}
