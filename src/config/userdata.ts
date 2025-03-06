import * as _ from "lodash";
import { Err, Ok, Result } from "ts-results";

import Storage, {
    LocalCourseData,
    LocalMoocCourseData,
    LocalTmcCourseData,
    LocalTmcCourseExercise,
} from "../api/storage";
import { assertUnreachable, CourseIdentifier, makeMoocKind, makeTmcKind } from "../shared/shared";
import { Logger } from "../utilities/logger";

export class UserData {
    private _tmcCourses: Map<number, LocalTmcCourseData>;
    // maps instance ids to course data
    private _moocCourses: Map<string, LocalMoocCourseData>;
    private _passedExercises: Set<number> = new Set();
    private _storage: Storage;
    constructor(storage: Storage) {
        const persistentData = storage.getUserData();
        if (persistentData) {
            this._tmcCourses = new Map(persistentData.courses.map((x) => [x.id, x]));
            this._moocCourses = new Map(persistentData.moocCourses.map((x) => [x.instanceId, x]));

            persistentData.courses.forEach((x) =>
                x.exercises.forEach((y) => {
                    if (y.passed) {
                        this._passedExercises.add(y.id);
                    }
                }),
            );
        } else {
            this._tmcCourses = new Map();
            this._moocCourses = new Map();
        }
        this._storage = storage;
    }

    public getCourses(): LocalCourseData[] {
        const tmc = this.getTmcCourses().map<LocalCourseData>(makeTmcKind);
        const mooc = this.getMoocCourses().map<LocalCourseData>(makeMoocKind);
        return tmc.concat(mooc);
    }

    public getTmcCourses(): LocalTmcCourseData[] {
        return Array.from(this._tmcCourses.values());
    }

    public getMoocCourses(): LocalMoocCourseData[] {
        return Array.from(this._moocCourses.values());
    }

    public getCourse(id: CourseIdentifier): Readonly<LocalCourseData> {
        switch (id.kind) {
            case "tmc": {
                const course = this._tmcCourses.get(id.courseId);
                return makeTmcKind(course);
            }
            case "mooc": {
                const course = this._moocCourses.get(id.instanceId);
                return makeMoocKind(course);
            }
            default: {
                assertUnreachable(id);
            }
        }
    }

    public getTmcCourse(id: number): Readonly<LocalTmcCourseData> {
        const course = this._tmcCourses.get(id);
        return course as LocalTmcCourseData;
    }

    public getTmcCourseByName(name: string): Readonly<LocalTmcCourseData> {
        return this.getTmcCourses().filter((x) => x.name === name)[0];
    }

    public getTmcExerciseByName(
        courseSlug: string,
        exerciseName: string,
    ): Readonly<LocalTmcCourseExercise> | undefined {
        for (const course of this._tmcCourses.values()) {
            if (course.name === courseSlug) {
                return course.exercises.find((x) => x.name === exerciseName);
            }
        }
    }

    public async setExerciseAsPassed(courseSlug: string, exerciseName: string): Promise<void> {
        for (const course of this._tmcCourses.values()) {
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

    public addCourse(data: LocalCourseData): void {
        switch (data.kind) {
            case "tmc": {
                const course = data.data;
                if (this._tmcCourses.has(course.id)) {
                    throw new Error("Trying to add an already existing course");
                }
                Logger.info(`Adding course ${course.name} to My Courses`);
                this._tmcCourses.set(course.id, course);
                break;
            }
            case "mooc": {
                const course = data.data;
                if (this._moocCourses.has(course.instanceId)) {
                    throw new Error("Trying to add an already existing course");
                }
                Logger.info(`Adding course ${course.courseName} to My Courses`);
                this._moocCourses.set(course.instanceId, course);
                break;
            }
            default: {
                assertUnreachable(data);
            }
        }
        this._updatePersistentData();
    }

    public addMoocCourse(data: LocalMoocCourseData): void {
        if (this._moocCourses.has(data.instanceId)) {
            throw new Error("Trying to add an already existing course");
        }
        Logger.info(`Adding course ${data.courseName} to My Courses`);
        this._moocCourses.set(data.instanceId, data);
        this._updatePersistentData();
    }

    public deleteCourse(id: number): void {
        this._tmcCourses.delete(id);
        this._updatePersistentData();
    }

    public async updateCourse(data: LocalCourseData): Promise<void> {
        switch (data.kind) {
            case "tmc": {
                const course = data.data;
                if (!this._tmcCourses.has(course.id)) {
                    throw new Error("Trying to fetch course that doesn't exist.");
                }
                this._tmcCourses.set(course.id, course);
                break;
            }
            case "mooc": {
                const course = data.data;
                if (!this._moocCourses.has(course.instanceId)) {
                    throw new Error("Trying to fetch course that doesn't exist.");
                }
                this._moocCourses.set(course.instanceId, course);
                break;
            }
            default: {
                assertUnreachable(data);
            }
        }
        await this._updatePersistentData();
    }

    public async updateExercises(
        courseId: number,
        exercises: LocalTmcCourseExercise[],
    ): Promise<Result<void, Error>> {
        const courseData = this._tmcCourses.get(courseId);
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
        this._tmcCourses.set(courseId, courseData);
        await this._updatePersistentData();
        return Ok.EMPTY;
    }

    public async updatePoints(
        courseId: number,
        awardedPoints: number,
        availablePoints: number,
    ): Promise<Result<void, Error>> {
        const courseData = this._tmcCourses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        courseData.awardedPoints = awardedPoints;
        courseData.availablePoints = availablePoints;
        this._tmcCourses.set(courseId, courseData);
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
        const courseData = this._tmcCourses.get(courseId);
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
        const courseData = this._tmcCourses.get(courseId);
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
        return this._storage.updateUserData({
            courses: Array.from(this._tmcCourses.values()),
            moocCourses: Array.from(this._moocCourses.values()),
        });
    }
}
