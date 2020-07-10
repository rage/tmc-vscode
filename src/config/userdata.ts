import { Err, Ok, Result } from "ts-results";

import { Logger } from "../utils/logger";

import Storage from "./storage";
import { LocalCourseData, LocalCourseExercise } from "./types";

export class UserData {
    private courses: Map<number, LocalCourseData>;
    private passedExercises: Set<number> = new Set();
    private storage: Storage;
    constructor(storage: Storage) {
        const persistentData = storage.getUserData();
        if (persistentData) {
            this.courses = new Map(persistentData.courses.map((x) => [x.id, x]));

            persistentData.courses.forEach((x) =>
                x.exercises.forEach((y) => {
                    if (y.passed) {
                        this.passedExercises.add(y.id);
                    }
                }),
            );
        } else {
            this.courses = new Map();
        }
        this.storage = storage;
    }

    public getCourses(): LocalCourseData[] {
        return Array.from(this.courses.values());
    }

    public getCourse(id: number): LocalCourseData {
        const course = this.courses.get(id);
        return course as LocalCourseData;
    }

    public getCourseByName(name: string): LocalCourseData {
        const course = this.getCourses().filter((x) => x.name === name);
        return course[0];
    }

    public addCourse(data: LocalCourseData): void {
        if (this.courses.has(data.id)) {
            throw new Error("Trying to add an already existing course");
        }
        Logger.log(`Adding course ${data.name} to My courses`);
        this.courses.set(data.id, data);
        this.updatePersistentData();
    }

    public deleteCourse(id: number): void {
        this.courses.delete(id);
        this.updatePersistentData();
    }

    public updateCourse(data: LocalCourseData): void {
        if (!this.courses.has(data.id)) {
            throw new Error("Trying to fetch course that doesn't exist.");
        }
        this.courses.set(data.id, data);
        this.updatePersistentData();
    }

    public async updateExercises(
        courseId: number,
        exercises: LocalCourseExercise[],
    ): Promise<Result<void, Error>> {
        const courseData = this.courses.get(courseId);
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
        courseData.newExercises.length > 0
            ? Logger.log(
                  `Found ${courseData.newExercises.length} new exercises for ${courseData.name}`,
              )
            : {};
        courseData.exercises = exercises;
        courseData.exercises.forEach((x) =>
            x.passed ? this.passedExercises.add(x.id) : this.passedExercises.delete(x.id),
        );
        this.courses.set(courseId, courseData);
        await this.updatePersistentData();
        return Ok.EMPTY;
    }

    public async updatePoints(
        courseId: number,
        awardedPoints: number,
        availablePoints: number,
    ): Promise<Result<void, Error>> {
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        courseData.awardedPoints = awardedPoints;
        courseData.availablePoints = availablePoints;
        this.courses.set(courseId, courseData);
        await this.updatePersistentData();
        return Ok.EMPTY;
    }

    public getPassed(exerciseId: number): boolean {
        return this.passedExercises.has(exerciseId);
    }

    /**
     * Clears the list of new exercises for a given course.
     */
    public async clearNewExercises(courseId: number): Promise<Result<void, Error>> {
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        Logger.log(`Clearing new exercises for ${courseData.name}`);
        courseData.newExercises = [];
        await this.updatePersistentData();
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
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        Logger.log(
            `Notifying user for course ${courseData.name} again at ${new Date(
                dateInMillis,
            ).toString()}`,
        );
        courseData.notifyAfter = dateInMillis;
        await this.updatePersistentData();
        return Ok.EMPTY;
    }

    private updatePersistentData(): Promise<void> {
        return this.storage.updateUserData({ courses: Array.from(this.courses.values()) });
    }
}
