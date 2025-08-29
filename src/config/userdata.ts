import Storage from "../storage";
import { v2 as storage } from "../storage/data";
import { Logger } from "../utilities/logger";
import * as _ from "lodash";
import { Err, Ok, Result } from "ts-results";

export class UserData {
    private _courses: Map<number, storage.LocalCourseData>;
    private _passedExercises: Set<number> = new Set();
    private _storage: Storage;
    constructor(storage: Storage) {
        const persistentData = storage.getUserData();
        if (persistentData) {
            this._courses = new Map(persistentData.courses.map((x) => [x.id, x]));

            persistentData.courses.forEach((x) =>
                x.exercises.forEach((y) => {
                    if (y.passed) {
                        this._passedExercises.add(y.id);
                    }
                }),
            );
        } else {
            this._courses = new Map();
        }
        this._storage = storage;
    }

    public getCourses(): storage.LocalCourseData[] {
        return Array.from(this._courses.values());
    }

    public getCourse(id: number): Readonly<storage.LocalCourseData> {
        const course = this._courses.get(id);
        return course as storage.LocalCourseData;
    }

    public getCourseByName(name: string): Readonly<storage.LocalCourseData> {
        return this.getCourses().filter((x) => x.name === name)[0];
    }

    public getExerciseByName(
        courseSlug: string,
        exerciseName: string,
    ): Readonly<storage.LocalCourseExercise> | undefined {
        for (const course of this._courses.values()) {
            if (course.name === courseSlug) {
                return course.exercises.find((x) => x.name === exerciseName);
            }
        }
    }

    public async setExerciseAsPassed(courseSlug: string, exerciseName: string): Promise<void> {
        for (const course of this._courses.values()) {
            if (course.name === courseSlug) {
                const exercise = course.exercises.find((x) => x.name === exerciseName);
                if (exercise) {
                    exercise.passed = true;
                    await this._updatePersistentData();
                    break;
                }
            }
        }
    }

    public addCourse(data: storage.LocalCourseData): void {
        if (this._courses.has(data.id)) {
            throw new Error("Trying to add an already existing course");
        }
        Logger.info(`Adding course ${data.name} to My Courses`);
        this._courses.set(data.id, data);
        this._updatePersistentData();
    }

    public deleteCourse(id: number): void {
        this._courses.delete(id);
        this._updatePersistentData();
    }

    public async updateCourse(data: storage.LocalCourseData): Promise<void> {
        if (!this._courses.has(data.id)) {
            throw new Error("Trying to fetch course that doesn't exist.");
        }
        this._courses.set(data.id, data);
        await this._updatePersistentData();
    }

    public async updateExercises(
        courseId: number,
        exercises: storage.LocalCourseExercise[],
    ): Promise<Result<void, Error>> {
        const courseData = this._courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        const exerciseIds = exercises.map((exercise) => exercise.id);
        // Filter out "new" exercises that no longer were in the API, and then append new data
        courseData.newExercises = courseData.newExercises
            .filter((exerciseId) => exerciseIds.includes(exerciseId))
            .concat(
                exerciseIds.filter(
                    (newExerciseId) => !courseData.exercises.find((e) => e.id === newExerciseId),
                ),
            );
        if (courseData.newExercises.length > 0) {
            Logger.info(
                `Found ${courseData.newExercises.length} new exercises for ${courseData.name}`,
            );
        }
        courseData.exercises = exercises;
        courseData.exercises.forEach((x) =>
            x.passed ? this._passedExercises.add(x.id) : this._passedExercises.delete(x.id),
        );
        this._courses.set(courseId, courseData);
        await this._updatePersistentData();
        return Ok.EMPTY;
    }

    public async updatePoints(
        courseId: number,
        awardedPoints: number,
        availablePoints: number,
    ): Promise<Result<void, Error>> {
        const courseData = this._courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        courseData.awardedPoints = awardedPoints;
        courseData.availablePoints = availablePoints;
        this._courses.set(courseId, courseData);
        await this._updatePersistentData();
        return Ok.EMPTY;
    }

    public getPassed(exerciseId: number): boolean {
        return this._passedExercises.has(exerciseId);
    }

    /**
     * Clears the list of new exercises for a given course.
     *
     * If given a list of exercise ids clears these from the course.newExercises array
     *
     * @param courseId
     * @param exercisesToClear Number list of exercises to clear.
     */
    public async clearFromNewExercises(
        courseId: number,
        exercisesToClear?: number[],
    ): Promise<Result<void, Error>> {
        const courseData = this._courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        Logger.info(`Clearing new exercises for ${courseData.name}`);
        if (exercisesToClear !== undefined) {
            const unSuccessfullyDownloaded = _.difference(
                courseData.newExercises,
                exercisesToClear,
            );
            courseData.newExercises = unSuccessfullyDownloaded;
            if (unSuccessfullyDownloaded.length === 0) {
                courseData.notifyAfter = 0;
            }
        } else {
            courseData.newExercises = [];
            courseData.notifyAfter = 0;
        }
        await this._updatePersistentData();
        return Ok.EMPTY;
    }

    /**
     * Sets a timeout for when the user can be notified about the given course the next time.
     *
     * @param courseId ID of the course where the notification timeout is being set.
     * @param dateInMillis Next possible notification date, in milliseconds.
     */
    public async setNotifyDate(
        courseId: number,
        dateInMillis: number,
    ): Promise<Result<void, Error>> {
        const courseData = this._courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        Logger.info(
            `Notifying user for course ${courseData.name} again at ${new Date(
                dateInMillis,
            ).toString()}`,
        );
        courseData.notifyAfter = dateInMillis;
        await this._updatePersistentData();
        return Ok.EMPTY;
    }

    /**
     * Tries to set all storage data to undefined.
     */
    public async wipeDataFromStorage(): Promise<void> {
        return this._storage.wipeStorage();
    }

    private _updatePersistentData(): Promise<void> {
        return this._storage.updateUserData({ courses: Array.from(this._courses.values()) });
    }
}
