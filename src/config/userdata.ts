import Storage from "./storage";

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

    public updateCompletedExercises(courseId: number, completedExercises: number[]) {
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return;
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
        this.updatePersistentData();
    }

    public setPassed(courseId: number, exerciseId: number): void {
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return;
        }
        courseData.exercises = courseData.exercises.map((x) => ({
            id: x.id,
            passed: exerciseId === x.id ? true : x.passed,
        }));
        this.passedExercises.add(exerciseId);
        this.courses.set(courseId, courseData);
        this.updatePersistentData();
    }

    public getPassed(exerciseId: number) {
        return this.passedExercises.has(exerciseId);
    }

    private updatePersistentData() {
        this.storage.updateUserData({ courses: Array.from(this.courses.values()) });
    }
}

export type LocalCourseData = {
    id: number;
    name: string;
    description: string;
    organization: string;
    exercises: Array<{
        id: number;
        passed: boolean;
    }>;
};
