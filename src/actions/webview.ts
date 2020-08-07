/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that provide webviews.
 * -------------------------------------------------------------------------------------------------
 */

import * as fs from "fs-extra";
import { Err, Ok, Result } from "ts-results";

import * as ConfigTypes from "../config/types";
import TemporaryWebview from "../ui/temporaryWebview";
import * as UITypes from "../ui/types";
import { chooseDeadline, dateToString, Logger, parseDate, parseNextDeadlineAfter } from "../utils/";

import { ActionContext } from "./types";
import { updateCourse } from "./user";
import { checkForExerciseUpdates } from "./workspace";

/**
 * Displays a summary page of user's courses.
 */
export async function displayUserCourses(actionContext: ActionContext): Promise<void> {
    const { userData, tmc, ui } = actionContext;
    Logger.log("Displaying My courses view");
    const courses = userData.getCourses().map((course) => {
        const completedPrc = ((course.awardedPoints / course.availablePoints) * 100).toFixed(2);
        return { ...course, completedPrc };
    });

    // Display the page immediatedly before fetching any data from API
    await ui.webview.setContentFromTemplate({ templateName: "index", courses });

    const uiState = ui.webview.getStateId();

    /**  Tries to update courses from API;
     * Also checks for disabled courses, if they are enabled again.
     * When going to My Courses view.
     */
    const apiCourses = await Promise.all(
        courses.map(async (course) => {
            const exerciseResult = await tmc.getCourseDetails(course.id);
            const deadlines = new Map<number, Date>();
            if (exerciseResult.ok) {
                exerciseResult.val.course.exercises.forEach((ex) => {
                    if (ex.deadline) {
                        deadlines.set(ex.id, parseDate(ex.deadline));
                    }
                    const chosenDeadline = chooseDeadline(ex);
                    if (chosenDeadline.date) {
                        deadlines.set(ex.id, chosenDeadline.date);
                    }
                });
            }

            await updateCourse(actionContext, course.id);
            const updatedCourse = userData.getCourse(course.id);
            course.disabled = updatedCourse.disabled;

            const completedPrc = (
                (updatedCourse.awardedPoints / updatedCourse.availablePoints) *
                100
            ).toFixed(2);
            const newExercises = updatedCourse.newExercises;
            const exercises = course.exercises.map((ex) => ({
                ...ex,
                deadline: deadlines.get(ex.id),
            }));
            const nextDeadline = parseNextDeadlineAfter(
                new Date(),
                exercises.map((exercise) => ({
                    date: exercise.deadline || null,
                    active: !exercise.passed,
                })),
            );
            return { ...course, exercises, nextDeadline, completedPrc, newExercises };
        }),
    );
    if (uiState === ui.webview.getStateId()) {
        await ui.webview.setContentFromTemplate({ templateName: "index", courses: apiCourses });
    }
}

/**
 * Displays details view for a local course.
 */
export async function displayLocalCourseDetails(
    actionContext: ActionContext,
    courseId: number,
): Promise<void> {
    const { ui, tmc, userData, workspaceManager } = actionContext;

    const checkFolderExistence = (exerciseId: number): boolean => {
        const exercisePath = workspaceManager.getExercisePathById(exerciseId);
        if (exercisePath.err) {
            return false;
        }
        if (!fs.existsSync(exercisePath.val) || fs.readdirSync(exercisePath.val).length === 0) {
            workspaceManager.setMissing(exerciseId);
            return false;
        }
        return true;
    };

    const mapStatus = (
        exercise: ConfigTypes.LocalExerciseData,
        expired: boolean,
    ): UITypes.ExerciseStatus => {
        switch (exercise.status) {
            case ConfigTypes.ExerciseStatus.CLOSED:
                return checkFolderExistence(exercise.id) ? "closed" : "missing";
            case ConfigTypes.ExerciseStatus.OPEN:
                return checkFolderExistence(exercise.id) ? "opened" : "missing";
            default:
                return expired ? "expired" : "new";
        }
    };

    const course = userData.getCourse(courseId);
    Logger.log(`Display course view for ${course.name}`);

    const workspaceExercises = workspaceManager.getExercisesByCourseName(course.name);
    const exerciseData = new Map<string, UITypes.CourseDetailsExerciseGroup>();
    const initialState: Array<{ key: string; message: UITypes.WebviewMessage }> = [];
    const apiCourse = (await tmc.getCourseDetails(courseId, true)).mapErr(() => undefined).val
        ?.course;
    const currentDate = new Date();

    /* Emergency solution.
    Match cached api data (obtained by entering My courses, which updates cache) to existing
    userdata for the webview, because we no longer show only downloaded exercises.
    (except offline mode) 
    */
    course.exercises.forEach((ex) => {
        const nameMatch = ex.name.match(/(\w+)-(.+)/);
        const groupName = nameMatch?.[1] || "";
        const group = exerciseData.get(groupName);
        const name = nameMatch?.[2] || "";
        let exData = workspaceExercises.find((d) => d.id === ex.id);
        const apiExercise = apiCourse?.exercises.find((e) => e.id === ex.id);
        if (
            (!exData || exData.status === ConfigTypes.ExerciseStatus.MISSING) &&
            apiCourse &&
            apiExercise
        ) {
            exData = {
                id: ex.id,
                name: ex.name,
                checksum: "",
                course: apiCourse.name,
                deadline: apiExercise.deadline,
                organization: course.organization,
                softDeadline: apiExercise.soft_deadline,
                status: ConfigTypes.ExerciseStatus.MISSING,
            };
        }
        if (!exData) {
            return;
        }
        const softDeadline = exData.softDeadline ? parseDate(exData.softDeadline) : null;
        const hardDeadline = exData.deadline ? parseDate(exData.deadline) : null;
        initialState.push({
            key: `exercise-${exData.id}-status`,
            message: {
                command: "exerciseStatusChange",
                exerciseId: exData.id,
                status: mapStatus(exData, hardDeadline !== null && currentDate >= hardDeadline),
            },
        });
        const entry: UITypes.CourseDetailsExercise = {
            id: ex.id,
            name,
            passed: course.exercises.find((ce) => ce.id === ex.id)?.passed || false,
            softDeadline,
            softDeadlineString: softDeadline ? dateToString(softDeadline) : "-",
            hardDeadline,
            hardDeadlineString: hardDeadline ? dateToString(hardDeadline) : "-",
            isHard: softDeadline && hardDeadline ? hardDeadline <= softDeadline : true,
        };

        exerciseData.set(groupName, {
            name: groupName,
            nextDeadlineString: "",
            exercises: group?.exercises.concat(entry) || [entry],
        });
    });

    const offlineMode = apiCourse === undefined;
    const courseGroups = Array.from(exerciseData.values())
        .sort((a, b) => (a.name > b.name ? 1 : -1))
        .map((e) => {
            return {
                ...e,
                exercises: e.exercises.sort((a, b) => (a.name > b.name ? 1 : -1)),
                nextDeadlineString: offlineMode
                    ? "Next deadline: Not available"
                    : parseNextDeadlineAfter(
                          currentDate,
                          e.exercises.map((ex) => ({
                              date: ex.isHard ? ex.hardDeadline : ex.softDeadline,
                              active: !ex.passed,
                          })),
                      ),
            };
        });

    await ui.webview.setContentFromTemplate(
        {
            templateName: "course-details",
            exerciseData: courseGroups,
            course,
            courseId: course.id,
            offlineMode,
        },
        true,
        initialState,
    );

    const updateables =
        (
            await checkForExerciseUpdates(actionContext, courseId, {
                notify: false,
                useCache: true,
            })
        ).find((u) => u.courseId === courseId)?.exerciseIds || [];
    ui.webview.postMessage({
        key: "course-updates",
        message: {
            command: "setUpdateables",
            exerciseIds: updateables,
        },
    });
}

/**
 * Lets the user select a course
 */
export async function selectCourse(
    actionContext: ActionContext,
    orgSlug: string,
    webview?: TemporaryWebview,
): Promise<Result<{ changeOrg: boolean; course?: number }, Error>> {
    const { tmc, resources, ui } = actionContext;
    const result = await tmc.getCourses(orgSlug);

    if (result.err) {
        return result;
    }
    const courses = result.val.sort((course1, course2) => course1.name.localeCompare(course2.name));
    const organization = (await tmc.getOrganization(orgSlug)).unwrap();
    const data = { courses, organization };
    let changeOrg = false;
    let course: number | undefined;

    await new Promise((resolve) => {
        const temp = webview || new TemporaryWebview(resources, ui);
        temp.setContent({
            title: "Select course",
            template: { templateName: "course", ...data },
            messageHandler: (msg: { type?: string; id?: number }) => {
                if (msg.type === "setCourse") {
                    course = msg.id;
                } else if (msg.type === "changeOrg") {
                    changeOrg = true;
                } else {
                    return;
                }
                if (!webview) {
                    temp.dispose();
                }
                resolve();
            },
        });
    });
    return new Ok({ changeOrg, course });
}

/**
 * Lets the user select an organization
 */
export async function selectOrganization(
    actionContext: ActionContext,
    webview?: TemporaryWebview,
): Promise<Result<string, Error>> {
    const { tmc, resources, ui } = actionContext;

    const result = await tmc.getOrganizations();
    if (result.err) {
        return result;
    }
    const organizations = result.val.sort((org1, org2) => org1.name.localeCompare(org2.name));
    const pinned = organizations.filter((organization) => organization.pinned);
    const data = { organizations, pinned };
    let slug: string | undefined;

    await new Promise((resolve) => {
        const temp = webview || new TemporaryWebview(resources, ui);
        temp.setContent({
            title: "Select organization",
            template: { templateName: "organization", ...data },
            messageHandler: (msg: { type?: string; slug?: string }) => {
                if (msg.type !== "setOrganization") {
                    return;
                }
                slug = msg.slug;
                if (!webview) {
                    temp.dispose();
                }
                resolve();
            },
        });
    });
    if (!slug) {
        return new Err(new Error("Couldn't get organization"));
    }
    return new Ok(slug);
}

/**
 * Creates a new temporary webview where user can select an organization and a course.
 */
export async function selectOrganizationAndCourse(
    actionContext: ActionContext,
): Promise<Result<{ organization: string; course: number }, Error>> {
    const { resources, ui } = actionContext;

    const tempView = new TemporaryWebview(resources, ui);

    let organizationSlug: string | undefined;
    let courseId: number | undefined;

    while (!(organizationSlug && courseId)) {
        const orgResult = await selectOrganization(actionContext, tempView);
        if (orgResult.err) {
            tempView.dispose();
            return orgResult;
        }
        Logger.log(`Organization slug ${orgResult.val} selected`);
        organizationSlug = orgResult.val;
        const courseResult = await selectCourse(actionContext, organizationSlug, tempView);
        if (courseResult.err) {
            tempView.dispose();
            return courseResult;
        }
        if (courseResult.val.changeOrg) {
            continue;
        }
        courseId = courseResult.val.course;
    }
    Logger.log(`Course with id ${courseId} selected`);
    tempView.dispose();
    return new Ok({ organization: organizationSlug, course: courseId });
}
