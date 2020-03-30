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
    compareDates,
    dateToString,
    findNextDateAfter,
    parseDate,
} from "../utils/dateDeadline";
import { ActionContext } from "./types";
import { Exercise } from "../api/types";

/**
 * Displays a summary page of user's courses.
 */
export async function displayUserCourses(actionContext: ActionContext): Promise<void> {
    const { userData, tmc, ui } = actionContext;

    const courses = userData.getCourses().map((course) => {
        const completedPrc = ((course.awardedPoints / course.availablePoints) * 100).toFixed(2);
        return { ...course, completedPrc };
    });

    // Display the page immediatedly before fetching any data from API
    await ui.webview.setContentFromTemplate("index", { courses });

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

            const exercises = course.exercises.map((ex) => ({
                ...ex,
                deadline: deadlines.get(ex.id),
            }));
            const nextDeadlineObject = findNextDateAfter(
                new Date(),
                exercises
                    .filter((exercise) => !exercise.passed)
                    .map((exercise) => (exercise.deadline ? exercise.deadline : null)),
            );
            const nextDeadline = nextDeadlineObject
                ? dateToString(nextDeadlineObject)
                : "Unavailable";

            return { ...course, exercises, nextDeadline };
        }),
    );
    if (uiState === ui.webview.getStateId()) {
        await ui.webview.setContentFromTemplate("index", { courses: apiCourses });
    }
}

/**
 * Displays details view for a local course.
 */
export async function displayLocalCourseDetails(
    courseId: number,
    actionContext: ActionContext,
): Promise<void> {
    const { ui, userData, workspaceManager } = actionContext;

    const course = userData.getCourse(courseId);
    const workspaceExercises = workspaceManager.getExercisesByCourseName(course.name);

    const exerciseData = new Map<
        number,
        {
            id: number;
            name: string;
            isOpen: boolean;
            isClosed: boolean;
            passed: boolean;
            deadlineString: string;
            hardDeadlineString: string;
            isHard: boolean;
        }
    >();

    workspaceExercises.forEach((ex) => {
        const date = new Date();
        let deadline = "-";
        let hard = true;
        if (ex.softDeadline != null && date < parseDate(ex.softDeadline)) {
            deadline = dateToString(parseDate(ex.softDeadline));
            hard = false;
        } else if (ex.deadline) {
            deadline = dateToString(parseDate(ex.deadline));
        }

        exerciseData.set(ex.id, {
            deadlineString: deadline,
            isHard: hard,
            hardDeadlineString: ex.deadline ? dateToString(parseDate(ex.deadline)) : "-",
            id: ex.id,
            isOpen: ex.status === ExerciseStatus.OPEN,
            isClosed: ex.status === ExerciseStatus.CLOSED,
            name: ex.name,
            passed: false,
        });
    });

    course.exercises.forEach((x) => {
        const data = exerciseData.get(x.id);
        if (data) {
            data.passed = x.passed;
            exerciseData.set(x.id, data);
        }
    });

    const sortedExercises = Array.from(exerciseData.values()).sort((a, b) =>
        a.deadlineString === b.deadlineString
            ? a.name.localeCompare(b.name)
            : compareDates(parseDate(a.deadlineString), parseDate(b.deadlineString)),
    );

    await ui.webview.setContentFromTemplate(
        "course-details",
        { exerciseData: sortedExercises, course, courseId: course.id },
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
        const temp = webview ? webview : new TemporaryWebview(resources, ui, "", () => {});
        temp.setTitle("Select course");
        temp.setMessageHandler((msg: { type?: string; id?: number }) => {
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
        });
        temp.setContent("course", data);
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
        const temp = webview ? webview : new TemporaryWebview(resources, ui, "", () => {});
        temp.setTitle("Select organization");
        temp.setMessageHandler((msg: { type?: string; slug?: string }) => {
            if (msg.type !== "setOrganization") {
                return;
            }
            slug = msg.slug;
            if (!webview) {
                temp.dispose();
            }
            resolve();
        });
        temp.setContent("organization", data);
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

    const tempView = new TemporaryWebview(resources, ui, "", () => {});

    let organizationSlug: string | undefined;
    let courseID: number | undefined;

    while (!(organizationSlug && courseID)) {
        const orgResult = await selectOrganization(actionContext, tempView);
        if (orgResult.err) {
            tempView.dispose();
            return new Err(orgResult.val);
        }
        organizationSlug = orgResult.val;
        const courseResult = await selectCourse(organizationSlug, actionContext, tempView);
        if (courseResult.err) {
            tempView.dispose();
            return new Err(courseResult.val);
        }
        if (courseResult.val.changeOrg) {
            continue;
        }
        courseID = courseResult.val.course;
    }

    tempView.dispose();
    return new Ok({ organization: organizationSlug, course: courseID });
}

/**
 * Displays the course exercise list view
 */
export async function displayCourseDownloads(
    courseId: number,
    actionContext: ActionContext,
): Promise<Result<void, Error>> {
    const { tmc, ui, userData, workspaceManager } = actionContext;
    await ui.webview.setContentFromTemplate("loading");
    const result = await tmc.getCourseDetails(courseId, false);
    if (result.err) {
        return new Err(new Error("Course details not found"));
    }
    const details = result.val.course;
    userData.updateCompletedExercises(
        courseId,
        details.exercises.filter((x) => x.completed).map((x) => x.id),
    );

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
    await ui.webview.setContentFromTemplate("download-exercises", data);
    return Ok.EMPTY;
}
