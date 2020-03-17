import Storage from "./storage";
import { Err, Ok, Result } from "ts-results";
import { LocalCourseData } from "./types";

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
        const course = this.getCourses().filter((x) => x.id === id);
        return course[0];
    }

    public getCourseByName(name: string): LocalCourseData {
        const course = this.getCourses().filter((x) => x.name === name);
        return course[0];
    }

    public addCourse(data: LocalCourseData): void {
        if (this.courses.has(data.id)) {
            throw new Error("Trying to add an already existing course");
        }
        this.courses.set(data.id, data);
        this.updatePersistentData();
    }

    public deleteCourse(id: number): void {
        this.courses.delete(id);
        this.updatePersistentData();
    }

    public async updateCompletedExercises(
        courseId: number,
        completedExercises: number[],
    ): Promise<Result<void, Error>> {
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        courseData.exercises = courseData.exercises.map((x) => ({
            id: x.id,
            passed: completedExercises.includes(x.id),
        }));
        courseData.exercises.forEach((x) =>
            completedExercises.includes(x.id)
                ? this.passedExercises.add(x.id)
                : this.passedExercises.delete(x.id),
        );
        this.courses.set(courseId, courseData);
        await this.updatePersistentData();
        return Ok.EMPTY;
    }

    public async setPassed(courseId: number, exerciseId: number): Promise<Result<void, Error>> {
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return new Err(new Error("Data missing"));
        }
        courseData.exercises = courseData.exercises.map((x) => ({
            id: x.id,
            passed: exerciseId === x.id ? true : x.passed,
        }));
        this.passedExercises.add(exerciseId);
        this.courses.set(courseId, courseData);
        await this.updatePersistentData();
        return Ok.EMPTY;
    }

    public getPassed(exerciseId: number): boolean {
        return this.passedExercises.has(exerciseId);
    }

    private updatePersistentData(): Promise<void> {
        return this.storage.updateUserData({ courses: Array.from(this.courses.values()) });
    }
}
