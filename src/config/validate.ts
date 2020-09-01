import { Err, Ok, Result } from "ts-results";
import { is } from "typescript-is";

import TMC from "../api/tmc";
import { CourseData, CourseDetails } from "../api/types";
import { ApiError, ConnectionError, ForbiddenError } from "../errors";
import TemporaryWebview from "../ui/temporaryWebview";
import UI from "../ui/ui";
import { Logger } from "../utils/logger";

import Resources from "./resources";
import Storage from "./storage";
import { ExerciseStatus, LocalCourseData, LocalExerciseData } from "./types";

/**
 * Check that workspace and userdata is up-to-date.
 * Uses cache, so that API requests in for loops can be re-used.
 */
export async function validateAndFix(
    storage: Storage,
    tmc: TMC,
    ui: UI,
    resources: Resources,
): Promise<Result<void, Error>> {
    const token = storage.getAuthenticationToken();
    if (token !== undefined) {
        const setTokenResult = await tmc.setAuthenticationToken(token);
        if (setTokenResult.err) {
            return setTokenResult;
        }
        await storage.updateAuthenticationToken(undefined);
    }

    const exerciseData = storage.getExerciseData() as unknown[];
    if (!is<LocalExerciseData[]>(exerciseData) && is<unknown[]>(exerciseData)) {
        const login = await ensureLogin(tmc, ui, resources);
        if (login.err) {
            return login;
        }

        Logger.log("Fixing workspacemanager data");
        const exerciseDataFixed: LocalExerciseData[] = [];
        for (const ex of exerciseData) {
            // If data objects doesn't have following fields or isOpen and status is undefined,
            // remove from storage. These are critical fields needed for the extension to work.
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
                (ex.isOpen === undefined && ex.status === undefined) ||
                ex.status === ExerciseStatus.MISSING
            ) {
                Logger.warn("Exercise missing or data is bad, removing:", ex);
                continue;
            }

            // Get the current status of the exercise
            const exerciseStatus =
                ex.isOpen !== undefined
                    ? ex.isOpen
                        ? ExerciseStatus.OPEN
                        : ExerciseStatus.CLOSED
                    : (ex.status as ExerciseStatus);

            const details = await getCourseDetails(tmc, ex.organization, ex.course);
            if (details.err) {
                if (details.val instanceof ApiError) {
                    Logger.warn(`Skipping bad workspacemanager data - ${details.val.message}`, ex);
                    exerciseDataFixed.push(ex as LocalExerciseData);
                    continue;
                } else if (details.val instanceof ForbiddenError) {
                    Logger.warn(`Forbidden: No access to exercise - ${details.val.message}`, ex);
                    exerciseDataFixed.push(ex as LocalExerciseData);
                    continue;
                }
                return new Err(details.val);
            }
            // Find the exercise from API Data and update fields.
            const exerciseDetails = details.val.course.exercises.find((x) => x.id === ex.id);
            if (exerciseDetails) {
                exerciseDataFixed.push({
                    checksum: ex.checksum,
                    course: details.val.course.name,
                    id: exerciseDetails.id,
                    status: exerciseStatus,
                    name: exerciseDetails.name,
                    organization: ex.organization,
                });
            }
        }
        storage.updateExerciseData(exerciseDataFixed);
        Logger.log("Workspacemanager data fixed");
    }
    const userData = storage.getUserData() as { courses: unknown[] };
    if (!is<{ courses: LocalCourseData[] }>(userData) && is<{ courses: unknown[] }>(userData)) {
        const login = await ensureLogin(tmc, ui, resources);
        if (login.err) {
            return login;
        }
        Logger.log("Fixing userdata");

        const userDataFixed: { courses: LocalCourseData[] } = { courses: [] };
        if (userData.courses !== undefined) {
            for (const course of userData.courses) {
                // If data objects doesn't have following fields or id and name is undefined,
                // remove from storage. These are critical fields needed for the extension to work.
                if (
                    !is<{
                        organization: string;
                        id?: number;
                        name?: string;
                        [key: string]: unknown;
                    }>(course) ||
                    (course.id === undefined && course.name === undefined)
                ) {
                    Logger.warn("Course data is bad, removing:", course);
                    continue;
                }

                /**
                 * Tries to fetch from TMC-VSCode cache, if data not found, fetches from TMC-langs.
                 * If `course.id` would be undefined and `course.name` not,
                 * try to find `course.id` from user visible courses using the name field.
                 */
                const courseDataResult = await (course.id !== undefined
                    ? tmc.getCourseData(course.id, true)
                    : getCourseData(tmc, course.organization, course.name as string));
                if (courseDataResult.err) {
                    if (courseDataResult.val instanceof ApiError) {
                        Logger.warn("Skipping bad userdata due to courseData", course);
                        userDataFixed.courses.push(course as LocalCourseData);
                        continue;
                    } else if (courseDataResult.val instanceof ForbiddenError) {
                        course.disabled = true;
                        Logger.warn(
                            `No access to courseData, disabling course - ${courseDataResult.val.message}`,
                            course,
                        );
                        userDataFixed.courses.push(course as LocalCourseData);
                        continue;
                    }
                    return new Err(courseDataResult.val);
                }
                const courseData = courseDataResult.val;

                const [availablePoints, awardedPoints] = courseData.exercises.reduce(
                    (a, b) => [a[0] + b.available_points.length, a[1] + b.awarded_points.length],
                    [0, 0],
                );

                userDataFixed.courses.push({
                    description: courseData.details.description || "",
                    exercises: courseData.details.exercises.map((x) => ({
                        id: x.id,
                        name: x.name,
                        deadline: x.deadline,
                        passed: x.completed,
                        softDeadline: x.soft_deadline,
                    })),
                    id: courseData.details.id,
                    name: courseData.details.name,
                    title: courseData.details.title,
                    organization: course.organization,
                    awardedPoints: awardedPoints,
                    availablePoints: availablePoints,
                    perhapsExamMode: courseData.settings.hide_submission_results,
                    notifyAfter: is<number>(course.notifyAfter) ? course.notifyAfter : 0,
                    newExercises: is<number[]>(course.newExercises) ? course.newExercises : [],
                    disabled: courseData.settings.disabled_status === "enabled" ? false : true,
                    material_url: courseData.settings.material_url,
                });
            }
        }
        storage.updateUserData(userDataFixed);
        Logger.log("Userdata fixed");
    }

    return Ok.EMPTY;
}

/**
 * Try to find the course ID from all TMC courses in given organization.
 */
async function findCourseInfo(
    tmc: TMC,
    org: string,
    course: string,
): Promise<Result<number, Error>> {
    const coursesResult = await tmc.getCourses(org, true);
    if (coursesResult.err) {
        return coursesResult;
    }

    const courseId = coursesResult.val.find((x) => x.name === course)?.id;
    if (!courseId) {
        return new Err(new ApiError("No such course in response"));
    }
    return new Ok(courseId);
}

async function getCourseData(
    tmc: TMC,
    org: string,
    course: string,
): Promise<Result<CourseData, Error>> {
    const courseId = await findCourseInfo(tmc, org, course);
    if (courseId.err) {
        return courseId;
    }
    return tmc.getCourseData(courseId.val, true);
}

async function getCourseDetails(
    tmc: TMC,
    org: string,
    course: string,
): Promise<Result<CourseDetails, Error>> {
    const courseId = await findCourseInfo(tmc, org, course);
    if (courseId.err) {
        return courseId;
    }
    return tmc.getCourseDetails(courseId.val, true);
}

async function ensureLogin(
    tmc: TMC,
    ui: UI,
    resources: Resources,
): Promise<Result<void, ConnectionError>> {
    while (!(await tmc.isAuthenticated()).unwrap()) {
        const loginMsg: {
            type?: "login";
            username?: string;
            password?: string;
        } = await new Promise((resolve) => {
            const temp = new TemporaryWebview(resources, ui);
            temp.setContent({
                title: "Login",
                template: { templateName: "login" },
                messageHandler: (msg: { type?: "login"; username?: string; password?: string }) => {
                    temp.dispose();
                    resolve(msg);
                },
            });
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
