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

    private updatePersistentData() {
        this.storage.updateUserData({ courses: Array.from(this.courses.values()) });
    }
}

export type LocalCourseData = {
    id: number;
    name: string;
    organization: string;
    exerciseIds: number[];
};
