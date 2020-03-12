import TMC from "../api/tmc";
import Storage from "./storage";

import { Err, Ok, Result } from "ts-results";
import { is } from "typescript-is";
import { CourseDetails, LocalExerciseData } from "../api/types";
import { ApiError, ConnectionError } from "../errors";
import TemporaryWebview from "../ui/temporaryWebview";
import UI from "../ui/ui";
import Resources from "./resources";
import { LocalCourseData } from "./userdata";

export async function validateAndFix(storage: Storage, tmc: TMC, ui: UI, resources: Resources)
: Promise<Result<void, Error>> {
    const exerciseData = storage.getExerciseData() as any[];
    if (!is<LocalExerciseData[]>(exerciseData)) {
        const login = await ensureLogin(tmc, ui, resources);
        if (login.err) { return new Err(login.val); }
        console.log("Fixing workspacemanager data");
        const exerciseDataFixed: LocalExerciseData[] = [];
        for (const ex of exerciseData) {
            if (ex.id === undefined || ex.isOpen === undefined || ex.organization === undefined ||
                ex.course === undefined || ex.path === undefined || ex.checksum === undefined) {
                continue;
            }

            const details = await getCourseDetails(tmc, ex.organization, ex.course);

            if (details.err) {
                if (details.val instanceof ApiError) {
                    console.log("Skipping bad workspacemanager data:", JSON.stringify(ex));
                    console.log(details.val);
                    continue;
                }
                return new Err(details.val);
            }
            const exerciseDetails = details.val.course.exercises.find((x) => x.id === ex.id);
            if (exerciseDetails) {
                exerciseDataFixed.push({ checksum: ex.checksum, course: ex.course, deadline: exerciseDetails.deadline,
                    id: ex.id, isOpen: ex.isOpen, name: ex.name, organization: ex.organization, path: ex.path });
            }
        }
        storage.updateExerciseData(exerciseDataFixed);
        console.log("Workspacemanager data fixed");
    }
    const userData = storage.getUserData() as any;
    if (!is<{ courses: LocalCourseData[] }>(userData)) {
        const login = await ensureLogin(tmc, ui, resources);
        if (login.err) { return new Err(login.val); }
        console.log("Fixing userdata");
        const userDataFixed: { courses: LocalCourseData[] } = { courses: [] };
        if (userData.courses !== undefined) {
            for (const course of userData.courses) {
                if (course.organization === undefined || (course.id === undefined && course.name === undefined)) {
                    break;
                }
                const courseDetails = await (course.id !== undefined
                    ? tmc.getCourseDetails(course.id)
                    : getCourseDetails(tmc, course.organization, course.name));
                if (courseDetails.err) {
                    if (courseDetails.val instanceof ApiError) {
                        console.log("Skipping bad userdata:", JSON.stringify(course));
                        continue;
                    }
                    return new Err(courseDetails.val);
                }
                const courseData = courseDetails.val.course;
                userDataFixed.courses.push({
                    description: courseData.description,
                    exercises: courseData.exercises.map((x) => ({ id: x.id, passed: x.completed })),
                    id: courseData.id, name: courseData.name, organization: course.organization,
                });
            }
        }
        storage.updateUserData(userDataFixed);
        console.log("Userdata fixed");
    }

    return Ok.EMPTY;
}

async function getCourseDetails(tmc: TMC, organization: string, course: string): Promise<Result<CourseDetails, Error>> {
    const coursesResult = await tmc.getCourses(organization);
    if (coursesResult.err) {
        return new Err(coursesResult.val);
    }

    const courseId = coursesResult.val.find((x) => x.name === course)?.id;
    if (!courseId) {
        return new Err(new ApiError("No such course in response"));
    }
    return tmc.getCourseDetails(courseId);
}

async function ensureLogin(tmc: TMC, ui: UI, resources: Resources): Promise<Result<void, ConnectionError>> {
    while (!tmc.isAuthenticated()) {
        const loginMsg: { type: "login", username: string, password: string } = await new Promise((resolve) => {
            const temp = new TemporaryWebview(resources, ui, "Login", (msg) => {
                temp.dispose();
                resolve(msg);
            });
            temp.setContent("login");
        });
        const authResult = await tmc.authenticate(loginMsg.username, loginMsg.password);
        if (authResult.err && authResult.val instanceof ConnectionError) {
            return new Err(authResult.val);
        }
    }

    return Ok.EMPTY;
}
