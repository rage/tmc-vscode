import * as _ from "lodash";
import { Err, Ok, Result } from "ts-results";

import Storage from "../storage";
import {
    assertUnreachable,
    CourseIdentifier,
    ExerciseIdentifier,
    makeMoocKind,
    makeTmcKind,
    match,
    LocalCourseData,
    LocalCourseExercise,
} from "../shared/shared";
import { Logger } from "../utilities/logger";
import {
    MoocLocalCourseData,
    MoocLocalCourseExercise,
    TmcLocalCourseData,
    TmcLocalCourseExercise,
} from "../storage/data";

export class UserData {
    private _tmcCourses: Map<number, TmcLocalCourseData>;
    // maps instance ids to course data
    private _moocCourses: Map<string, MoocLocalCourseData>;
    private _passedExercises: Set<ExerciseIdentifier> = new Set();
    private _storage: Storage;
    constructor(storage: Storage) {
        const persistentData = storage.getUserData();
        if (persistentData) {
            this._tmcCourses = new Map(persistentData.courses.map((x) => [x.id, x]));
            this._moocCourses = new Map(persistentData.mooc_courses.map((x) => [x.id, x]));

            persistentData.courses.forEach((x) =>
                x.exercises.forEach((y) => {
                    if (y.passed) {
                        this._passedExercises.add(ExerciseIdentifier.from(y.id));
                    }
                }),
            );
            persistentData.mooc_courses.forEach((x) =>
                x.exercises.forEach((y) => {
                    if (y.passed) {
                        this._passedExercises.add(ExerciseIdentifier.from(y.id));
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

    public getTmcCourses(): TmcLocalCourseData[] {
        return Array.from(this._tmcCourses.values());
    }

    public getMoocCourses(): MoocLocalCourseData[] {
        return Array.from(this._moocCourses.values());
    }

    public getCourse(id: CourseIdentifier): LocalCourseData {
        switch (id.kind) {
            case "tmc": {
                const course = this._tmcCourses.get(id.data.courseId);
                if (!course) {
                    throw "nonexistent course";
                }
                return makeTmcKind(course);
            }
            case "mooc": {
                const course = this._moocCourses.get(id.data.instanceId);
                if (!course) {
                    throw "nonexistent course";
                }
                return makeMoocKind(course);
            }
            default: {
                assertUnreachable(id);
            }
        }
    }

    public getCourseBySlug(slug: string): LocalCourseData {
        throw "todo";
    }

    public getTmcCourse(id: number): Readonly<TmcLocalCourseData> {
        const course = this._tmcCourses.get(id);
        return course as TmcLocalCourseData;
    }

    public getTmcCourseByName(name: string): Readonly<TmcLocalCourseData> {
        return this.getTmcCourses().filter((x) => x.name === name)[0];
    }

    public getExerciseByName(
        courseSlug: string,
        exerciseName: string,
    ): Readonly<LocalCourseExercise> | undefined {
        for (const course of this._tmcCourses.values()) {
            if (course.name === courseSlug) {
                const exercise = course.exercises.find((x) => x.name === exerciseName);
                return exercise ? makeTmcKind(exercise) : undefined;
            }
        }
        for (const course of this._moocCourses.values()) {
            if (course.name === courseSlug) {
                const exercise = course.exercises.find((x) => x.name === exerciseName);
                return exercise ? makeMoocKind(exercise) : undefined;
            }
        }
    }

    public getTmcExerciseByName(
        courseSlug: string,
        exerciseName: string,
    ): Readonly<TmcLocalCourseExercise> | undefined {
        for (const course of this._tmcCourses.values()) {
            if (course.name === courseSlug) {
                return course.exercises.find((x) => x.name === exerciseName);
            }
        }
    }

    public getMoocExerciseByName(
        courseSlug: string,
        exerciseName: string,
    ): Readonly<MoocLocalCourseExercise> | undefined {
        for (const course of this._moocCourses.values()) {
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
                const course = data;
                if (this._tmcCourses.has(course.data.id)) {
                    throw new Error("Trying to add an already existing course");
                }
                Logger.info(`Adding course ${course.data.name} to My Courses`);
                this._tmcCourses.set(course.data.id, course.data);
                break;
            }
            case "mooc": {
                const course = data;
                if (this._moocCourses.has(course.data.id)) {
                    throw new Error("Trying to add an already existing course");
                }
                Logger.info(`Adding course ${course.data.name} to My Courses`);
                this._moocCourses.set(course.data.id, course.data);
                break;
            }
            default: {
                assertUnreachable(data);
            }
        }
        this._updatePersistentData();
    }

    public addMoocCourse(data: MoocLocalCourseData): void {
        if (this._moocCourses.has(data.id)) {
            throw new Error("Trying to add an already existing course");
        }
        Logger.info(`Adding course ${data.name} to My Courses`);
        this._moocCourses.set(data.id, data);
        this._updatePersistentData();
    }

    public deleteCourse(id: CourseIdentifier): void {
        match(
            id,
            (tmc) => {
                this._tmcCourses.delete(tmc.courseId);
            },
            (mooc) => {
                this._moocCourses.delete(mooc.instanceId);
            },
        );
        this._updatePersistentData();
    }

    public async updateCourse(data: LocalCourseData): Promise<void> {
        switch (data.kind) {
            case "tmc": {
                const course = data;
                if (!this._tmcCourses.has(course.data.id)) {
                    throw new Error("Trying to fetch course that doesn't exist.");
                }
                this._tmcCourses.set(course.data.id, course.data);
                break;
            }
            case "mooc": {
                const course = data;
                if (!this._moocCourses.has(course.data.id)) {
                    throw new Error("Trying to fetch course that doesn't exist.");
                }
                this._moocCourses.set(course.data.id, course.data);
                break;
            }
            default: {
                assertUnreachable(data);
            }
        }
        await this._updatePersistentData();
    }

    public async updateExercises(
        courseId: CourseIdentifier,
        exercises: LocalCourseExercise[],
    ): Promise<Result<void, Error>> {
        const courseData = this.getCourse(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        const courseExercises = LocalCourseData.getExercises(courseData);
        const newExercises = LocalCourseData.getNewExercises(courseData);
        const exerciseIds = exercises.map((exercise) => exercise.data.id);
        // Filter out "new" exercises that no longer were in the API, and then append new data
        courseData.data.newExercises = match(
            courseData,
            (tmc) =>
                tmc.newExercises
                    .filter((exerciseId) => exerciseIds.includes(exerciseId))
                    .concat(
                        exerciseIds
                            .filter((eid) => typeof eid === "number")
                            .filter(
                                (newExerciseId) =>
                                    !courseExercises.find((e) => e.data.id === newExerciseId),
                            ),
                    ),
            (mooc) =>
                mooc.newExercises
                    .filter((exerciseId) => exerciseIds.includes(exerciseId))
                    .concat(
                        exerciseIds
                            .filter((eid) => typeof eid === "string")
                            .filter(
                                (newExerciseId) =>
                                    !courseExercises.find((e) => e.data.id === newExerciseId),
                            ),
                    ),
        );
        if (courseData.data.newExercises.length > 0) {
            Logger.info(
                `Found ${courseData.data.newExercises.length} new exercises for ${LocalCourseData.getNewExercises(courseData)}`,
            );
        }
        exercises.forEach((x) => {
            const id = ExerciseIdentifier.from(x.data.id);
            return x.data.passed ? this._passedExercises.add(id) : this._passedExercises.delete(id);
        });
        match(
            courseData,
            (tmc) => {
                tmc.exercises = exercises
                    .map((e) =>
                        match(
                            e,
                            (tmc) => tmc,
                            (mooc) => undefined,
                        ),
                    )
                    .filter((e) => e !== undefined);
            },
            (mooc) => {
                mooc.exercises = exercises
                    .map((e) =>
                        match(
                            e,
                            (tmc) => undefined,
                            (mooc) => mooc,
                        ),
                    )
                    .filter((e) => e !== undefined);
            },
        );
        this.addCourse(courseData);
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

    public getPassed(exerciseId: ExerciseIdentifier): boolean {
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
        courseId: CourseIdentifier,
        exercisesToClear?: ExerciseIdentifier[],
    ): Promise<Result<void, Error>> {
        let courseData = this.getCourse(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        const newExercises = courseData.data.newExercises.map(ExerciseIdentifier.from);
        Logger.info(`Clearing new exercises`);
        if (exercisesToClear !== undefined) {
            const unSuccessfullyDownloaded = _.difference(newExercises, exercisesToClear);
            let tmcIds: number[] = [];
            let moocIds: string[] = [];
            unSuccessfullyDownloaded.forEach((id) =>
                match(
                    id,
                    (tmc) => tmcIds.push(tmc.tmcExerciseId),
                    (mooc) => moocIds.push(mooc.moocExerciseId),
                ),
            );
            if (tmcIds.length !== 0) {
                courseData.data.newExercises = tmcIds;
            }
            if (moocIds.length !== 0) {
                courseData.data.newExercises = moocIds;
            }
            if (unSuccessfullyDownloaded.length === 0) {
                courseData.data.notifyAfter = 0;
            }
        } else {
            courseData.data.newExercises = [];
            courseData.data.notifyAfter = 0;
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
        courseId: CourseIdentifier,
        dateInMillis: number,
    ): Promise<Result<void, Error>> {
        const courseData = match(
            courseId,
            (tmc) => this._tmcCourses.get(tmc.courseId),
            (mooc) => this._moocCourses.get(mooc.instanceId),
        );
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        Logger.info(`Notifying user for course again at ${new Date(dateInMillis).toString()}`);
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
            mooc_courses: Array.from(this._moocCourses.values()),
        });
    }
}
