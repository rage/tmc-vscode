import TMC from "../api/tmc";
import Storage from "./storage";

import { Err, Ok, Result } from "ts-results";
import { is } from "typescript-is";
import { CourseDetails, CourseExercise } from "../api/types";
import { ApiError, ConnectionError } from "../errors";
import TemporaryWebview from "../ui/temporaryWebview";
import UI from "../ui/ui";
import Resources from "./resources";
import { ExerciseStatus, ExtensionSettings, LocalCourseData, LocalExerciseData } from "./types";

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
                    organization: string;
                    checksum: string;
                    id: number;
                    course: string;
                    isOpen?: boolean;
                    status?: ExerciseStatus;
                    [key: string]: unknown;
                }>(ex) ||
                (ex.isOpen === undefined && ex.status === undefined)
            ) {
                continue;
            }

            const exerciseStatus =
                ex.isOpen !== undefined
                    ? ex.isOpen
                        ? ExerciseStatus.OPEN
                        : ExerciseStatus.CLOSED
                    : (ex.status as ExerciseStatus);
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
                exerciseDataFixed.push({
                    checksum: ex.checksum,
                    course: details.val.course.name,
                    deadline: exerciseDetails.deadline,
                    softDeadline: exerciseDetails.soft_deadline,
                    id: exerciseDetails.id,
                    status: exerciseStatus,
                    name: exerciseDetails.name,
                    organization: ex.organization,
                    updateAvailable: false,
                    oldSubmissions: [],
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

                const courseExercises = await (course.id !== undefined
                    ? tmc.getCourseExercises(course.id)
                    : getCourseExercises(tmc, course.organization, course.name as string));

                if (courseExercises.err) {
                    if (courseDetails.val instanceof ApiError) {
                        console.log("Skipping bad userdata:", JSON.stringify(course));
                        continue;
                    }
                    return new Err(courseExercises.val);
                }
                const courseData = courseDetails.val.course;
                const exerciseData = courseExercises.val;
                const [availablePoints, awardedPoints] = exerciseData.reduce(
                    (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
                    [0, 0],
                );
                userDataFixed.courses.push({
                    description: courseData.description || "",
                    exercises: courseData.exercises.map((x) => ({ id: x.id, passed: x.completed })),
                    id: courseData.id,
                    name: courseData.name,
                    organization: course.organization,
                    awardedPoints: awardedPoints,
                    availablePoints: availablePoints,
                });
            }
        }
        storage.updateUserData(userDataFixed);
        console.log("Userdata fixed");
    }

    const settings = storage.getExtensionSettings();
    if (!is<ExtensionSettings | undefined>(settings)) {
        console.log("Fixing extension settings");
        const settingsFixed = undefined;
        storage.updateExtensionSettings(settingsFixed);
        console.log("Extension settings fixed");
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

async function getCourseExercises(
    tmc: TMC,
    org: string,
    course: string,
): Promise<Result<CourseExercise[], Error>> {
    const coursesResult = await tmc.getCourses(org);
    if (coursesResult.err) {
        return new Err(coursesResult.val);
    }

    const courseId = coursesResult.val.find((x) => x.name === course)?.id;
    if (!courseId) {
        return new Err(new ApiError("No such course in response"));
    }
    return tmc.getCourseExercises(courseId);
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
