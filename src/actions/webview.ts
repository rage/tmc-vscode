/**
 * ---------------------------------------------------------------------------------------------------------------------
 * Group of actions that provide webviews.
 * ---------------------------------------------------------------------------------------------------------------------
 */

import { Err, Ok, Result } from "ts-results";
import { ExerciseStatus } from "../config/types";
import TemporaryWebview from "../ui/temporaryWebview";
import {
    chooseDeadline,
    dateToString,
    parseDate,
    parseNextDeadlineAfter,
    showNotification,
} from "../utils/";
import { ActionContext } from "./types";
import { Exercise } from "../api/types";
import { updateCourse } from "./user";
import { checkForExerciseUpdates } from "./workspace";
import { CourseDetailsExercise, CourseDetailsExerciseGroup } from "../ui/types";

/**
 * Displays a summary page of user's courses.
 */
export async function displayUserCourses(actionContext: ActionContext): Promise<void> {
    const { userData, tmc, ui, logger } = actionContext;
    logger.log("Displaying My courses view");
    const courses = userData.getCourses().map((course) => {
        const completedPrc = ((course.awardedPoints / course.availablePoints) * 100).toFixed(2);
        return { ...course, completedPrc };
    });

    // Display the page immediatedly before fetching any data from API
    await ui.webview.setContentFromTemplate({ templateName: "index", courses });

    const uiState = ui.webview.getStateId();

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

            await updateCourse(course.id, actionContext);
            const updatedCourse = userData.getCourse(course.id);
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
                exercises
                    .filter((exercise) => !exercise.passed)
                    .map((exercise) => (exercise.deadline ? exercise.deadline : null)),
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
    courseId: number,
    actionContext: ActionContext,
): Promise<void> {
    const { ui, tmc, userData, workspaceManager, logger } = actionContext;

    const course = userData.getCourse(courseId);
    logger.log(`Display course view for ${course.name}`);
    const workspaceExercises = workspaceManager.getExercisesByCourseName(course.name);
    const exerciseData = new Map<string, CourseDetailsExerciseGroup>();
    const apiCourse = (await tmc.getCourseDetails(courseId, true)).mapErr(() => undefined).val
        ?.course;
    const updateables =
        (
            await checkForExerciseUpdates(actionContext, courseId, {
                notify: false,
                useCache: true,
            })
        ).find((u) => u.courseId === courseId)?.exerciseIds || [];
    const currentDate = new Date();
    course.exercises.forEach((ex) => {
        const nameMatch = ex.name.match(/(\w+)-(.+)/);
        const groupName = nameMatch?.[1] || "";
        const group = exerciseData.get(groupName);
        const name = nameMatch?.[2] || "";
        let exData = workspaceExercises.find((d) => d.id === ex.id);
        let downloadables = group?.downloadables || [];
        const apiExercise = apiCourse?.exercises.find((e) => e.id === ex.id);
        if ((!exData || exData.status === ExerciseStatus.MISSING) && apiCourse && apiExercise) {
            exData = {
                id: ex.id,
                name: ex.name,
                checksum: "",
                course: apiCourse.name,
                deadline: apiExercise.deadline,
                organization: course.organization,
                softDeadline: apiExercise.soft_deadline,
                status: ExerciseStatus.MISSING,
                updateAvailable: false,
            };
            downloadables = downloadables.concat(ex.id);
        }
        if (!exData) {
            return;
        }
        const softDeadline = exData.softDeadline ? parseDate(exData.softDeadline) : null;
        const hardDeadline = exData.deadline ? parseDate(exData.deadline) : null;
        const entry: CourseDetailsExercise = {
            id: ex.id,
            name,
            isOpen: exData.status === ExerciseStatus.OPEN,
            isClosed: exData.status === ExerciseStatus.CLOSED,
            expired: hardDeadline ? currentDate >= hardDeadline : false,
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
            downloadables,
        });
    });

    const exercisesDatam = Array.from(exerciseData.values())
        .sort((a, b) => (a.name > b.name ? 1 : -1))
        .map((e) => {
            return {
                ...e,
                exercises: e.exercises.sort((a, b) => (a.name > b.name ? 1 : -1)),
                nextDeadlineString: parseNextDeadlineAfter(
                    currentDate,
                    e.exercises.map((ex) => (ex.isHard ? ex.hardDeadline : ex.softDeadline)),
                ),
            };
        });
    await ui.webview.setContentFromTemplate(
        {
            templateName: "course-details",
            exerciseData: exercisesDatam,
            course,
            courseId: course.id,
            updateableExerciseIds: updateables,
        },
        true,
    );
}

/**
 * Lets the user select a course
 */
export async function selectCourse(
    orgSlug: string,
    actionContext: ActionContext,
    webview?: TemporaryWebview,
): Promise<Result<{ changeOrg: boolean; course?: number }, Error>> {
    const { tmc, resources, ui } = actionContext;
    const result = await tmc.getCourses(orgSlug);

    if (result.err) {
        return new Err(result.val);
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
        return new Err(result.val);
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
    const { resources, ui, logger } = actionContext;

    const tempView = new TemporaryWebview(resources, ui);

    let organizationSlug: string | undefined;
    let courseId: number | undefined;

    while (!(organizationSlug && courseId)) {
        const orgResult = await selectOrganization(actionContext, tempView);
        if (orgResult.err) {
            tempView.dispose();
            return new Err(orgResult.val);
        }
        logger.log(`Organization slug ${orgResult.val} selected`);
        organizationSlug = orgResult.val;
        const courseResult = await selectCourse(organizationSlug, actionContext, tempView);
        if (courseResult.err) {
            tempView.dispose();
            return new Err(courseResult.val);
        }
        if (courseResult.val.changeOrg) {
            continue;
        }
        courseId = courseResult.val.course;
    }
    logger.log(`Course with id ${courseId} selected`);
    tempView.dispose();
    return new Ok({ organization: organizationSlug, course: courseId });
}

/**
 * Displays the course exercise list view
 */
export async function displayCourseDownloads(
    actionContext: ActionContext,
    courseId: number,
): Promise<Result<void, Error>> {
    const { tmc, ui, userData, workspaceManager } = actionContext;
    await ui.webview.setContentFromTemplate({ templateName: "loading" });
    const result = await tmc.getCourseDetails(courseId);
    if (result.err) {
        return new Err(new Error("Course details not found"));
    }
    const details = result.val.course;
    await userData.updateExercises(
        courseId,
        details.exercises.map((x) => ({ id: x.id, name: x.name, passed: x.completed })),
    );
    const newExercisesLength = userData.getCourse(courseId).newExercises.length;
    if (newExercisesLength > 0) {
        showNotification(
            `Please download the ${newExercisesLength} new exercises, in the future you will not be notified about them again.`,
            ["OK", (): void => {}],
        );
        await userData.clearNewExercises(courseId);
    }

    const organizationSlug = userData.getCourses().find((course) => course.id === courseId)
        ?.organization;
    if (!organizationSlug) {
        return new Err(new Error("Course data not found"));
    }

    const allExercises: {
        exercise: Exercise;
        correctDeadline: string;
        isHard: boolean;
        hardDeadlineString: string;
    }[] = [];
    details.exercises.forEach((ex) => {
        const deadline = chooseDeadline(ex);
        if (deadline.date && !deadline.isHard) {
            const data = {
                exercise: ex,
                correctDeadline: dateToString(deadline.date),
                isHard: deadline.isHard,
                hardDeadlineString: ex.deadline ? dateToString(parseDate(ex.deadline)) : "-",
            };
            allExercises.push(data);
        } else {
            const data = {
                exercise: ex,
                correctDeadline: ex.deadline ? dateToString(parseDate(ex.deadline)) : "-",
                isHard: true,
                hardDeadlineString: ex.deadline ? dateToString(parseDate(ex.deadline)) : "-",
            };
            allExercises.push(data);
        }
    });

    const [
        uncompletedExercises,
        completedExercises,
        downloadedExercises,
        updatedExercises,
    ] = allExercises.reduce<
        [
            {
                exercise: Exercise;
                correctDeadline: string;
                isHard: boolean;
                hardDeadlineString: string;
            }[],
            {
                exercise: Exercise;
                correctDeadline: string;
                isHard: boolean;
                hardDeadlineString: string;
            }[],
            {
                exercise: Exercise;
                correctDeadline: string;
                isHard: boolean;
                hardDeadlineString: string;
            }[],
            {
                exercise: Exercise;
                correctDeadline: string;
                isHard: boolean;
                hardDeadlineString: string;
            }[],
        ]
    >(
        (a, x) => {
            if (
                workspaceManager
                    .getExerciseDataById(x.exercise.id)
                    .map((x) => x.updateAvailable)
                    .mapErr(() => false).val
            ) {
                a[3].push(x);
            } else if (
                workspaceManager
                    .getExerciseDataById(x.exercise.id)
                    .map((x) => x.status !== ExerciseStatus.MISSING)
                    .mapErr(() => false).val
            ) {
                a[2].push(x);
            } else if (x.exercise.completed) {
                a[1].push(x);
            } else if (!x.exercise.locked) {
                a[0].push(x);
            }
            return a;
        },
        [[], [], [], []],
    );

    const exerciseLists = [
        {
            id: "uncompletedExercises",
            exercises: uncompletedExercises,
            button: "Uncompleted",
            title: "Uncompleted exercises",
            downloadable: true,
            showDeadline: true,
        },
        {
            id: "completedExercises",
            exercises: completedExercises,
            button: "Completed",
            title: "Completed exercises",
            downloadable: true,
        },
        {
            id: "downloadedExercises",
            exercises: downloadedExercises,
            button: "Downloaded",
            title: "Downloaded exercises",
        },
        {
            id: "updatedExercises",
            exercises: updatedExercises,
            button: "Updateable",
            title: "Updateable exercises",
            downloadable: true,
            showDeadline: true,
        },
    ];

    const data = {
        courseId,
        courseName: result.val.course.name,
        details,
        organizationSlug,
        exerciseLists,
    };
    await ui.webview.setContentFromTemplate({ templateName: "download-exercises", ...data });
    return Ok.EMPTY;
}
