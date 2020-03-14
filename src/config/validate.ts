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

export async function validateAndFix(
    storage: Storage,
    tmc: TMC,
    ui: UI,
    resources: Resources,
): Promise<Result<void, Error>> {
    const exerciseData = storage.getExerciseData() as unknown[];
    if (!is<LocalExerciseData[]>(exerciseData) && is<unknown[]>(exerciseData)) {
        const login = await ensureLogin(tmc, ui, resources);
        if (login.err) {
            return new Err(login.val);
        }
        console.log("Fixing workspacemanager data");
        const exerciseDataFixed: LocalExerciseData[] = [];
        for (const ex of exerciseData) {
            if (
                !is<{
                    isOpen: boolean;
                    organization: string;
                    path: string;
                    checksum: string;
                    course?: string;
                    id?: number;
                    [key: string]: unknown;
                }>(ex) ||
                (ex.course === undefined && ex.id === undefined)
            ) {
                continue;
            }

            // TypeScript can't quite determine that either ex.id or ex.course must exist
            const details = await (ex.id !== undefined
                ? tmc.getCourseDetails(ex.id)
                : getCourseDetails(tmc, ex.organization, ex.course as string));

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
                exerciseDataFixed.push({
                    checksum: ex.checksum,
                    course: details.val.course.name,
                    deadline: exerciseDetails.deadline,
                    id: exerciseDetails.id,
                    isOpen: ex.isOpen,
                    name: exerciseDetails.name,
                    organization: ex.organization,
                    path: ex.path,
                });
            }
        }
        storage.updateExerciseData(exerciseDataFixed);
        console.log("Workspacemanager data fixed");
    }
    const userData = storage.getUserData() as { courses: unknown[] };
    if (!is<{ courses: LocalCourseData[] }>(userData) && is<{ courses: unknown[] }>(userData)) {
        const login = await ensureLogin(tmc, ui, resources);
        if (login.err) {
            return new Err(login.val);
        }
        console.log("Fixing userdata");
        const userDataFixed: { courses: LocalCourseData[] } = { courses: [] };
        if (userData.courses !== undefined) {
            for (const course of userData.courses) {
                if (
                    !is<{
                        organization: string;
                        id?: number;
                        name?: string;
                        [key: string]: unknown;
                    }>(course) ||
                    (course.id === undefined && course.name == undefined)
                ) {
                    continue;
                }
                // See comment above
                const courseDetails = await (course.id !== undefined
                    ? tmc.getCourseDetails(course.id)
                    : getCourseDetails(tmc, course.organization, course.name as string));
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
                    id: courseData.id,
                    name: courseData.name,
                    organization: course.organization,
                });
            }
        }
        storage.updateUserData(userDataFixed);
        console.log("Userdata fixed");
    }

    return Ok.EMPTY;
}

async function getCourseDetails(
    tmc: TMC,
    organization: string,
    course: string,
): Promise<Result<CourseDetails, Error>> {
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

async function ensureLogin(
    tmc: TMC,
    ui: UI,
    resources: Resources,
): Promise<Result<void, ConnectionError>> {
    while (!tmc.isAuthenticated()) {
        const loginMsg: {
            type?: "login";
            username?: string;
            password?: string;
        } = await new Promise((resolve) => {
            const temp = new TemporaryWebview(
                resources,
                ui,
                "Login",
                (msg: { type?: "login"; username?: string; password?: string }) => {
                    temp.dispose();
                    resolve(msg);
                },
            );
            temp.setContent("login");
        });
        if (!loginMsg.username || !loginMsg.password) {
            continue;
        }
        const authResult = await tmc.authenticate(loginMsg.username, loginMsg.password);
        if (authResult.err && authResult.val instanceof ConnectionError) {
            return new Err(authResult.val);
        }
    }

    return Ok.EMPTY;
}
