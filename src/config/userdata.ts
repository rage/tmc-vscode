import Storage from "./storage";

export class UserData {
    private courses: Map<number, LocalCourseData>;
    private storage: Storage;
    constructor(storage: Storage) {
        const persistentData = storage.getUserData();
        if (persistentData) {
            this.courses = new Map(persistentData.courses.map((x) => [x.id, x]));
        } else {
            this.courses = new Map();
        }
        this.storage = storage;
    }

    public getCourses(): LocalCourseData[] {
        return Array.from(this.courses.values());
    }

    public getCourse(id: number) {
        const course = this.getCourses().filter((x) => x.id === id);
        return course[0];
    }

    public addCourse(data: LocalCourseData) {
        if (this.courses.has(data.id)) {
            throw new Error("Trying to add an already existing course");
        }
        this.courses.set(data.id, data);
        this.updatePersistentData();
    }

    public deleteCourse(id: number) {
        this.courses.delete(id);
        this.updatePersistentData();
    }

    public updateCompletedExercises(courseId: number, completedExercises: number[]) {
        const courseData = this.courses.get(courseId);
        if (!courseData) {
            return;
        }
        courseData.completedExercises = completedExercises;
        this.courses.set(courseId, courseData);
        this.updatePersistentData();
    }

    public getCoursesLocalExercises(courseName: string) {
        const exercises = this.storage.getExerciseData();
        if (!exercises) {
            return;
        }
        return exercises.filter((x) => x.course === courseName);
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
    exerciseIds: number[];
    completedExercises: number[];
};
