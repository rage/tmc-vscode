import { Result } from "ts-results";

import { LocalCourseData } from "../api/storage";
import { Logger } from "../utils";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";
import { displayUserCourses, selectOrganizationAndCourse } from "./webview";

/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(
    actionContext: ActionContext,
    organization?: string,
    course?: number,
): Promise<Result<void, Error>> {
    const { tmc, ui, userData, workspaceManager } = actionContext;
    Logger.log("Adding new course");

    if (!organization || !course) {
        const orgAndCourse = await selectOrganizationAndCourse(actionContext);
        if (orgAndCourse.err) {
            return orgAndCourse;
        }
        organization = orgAndCourse.val.organization;
        course = orgAndCourse.val.course;
    }

    const courseDataResult = await tmc.getCourseData(course);
    if (courseDataResult.err) {
        return courseDataResult;
    }
    const courseData = courseDataResult.val;

    let availablePoints = 0;
    let awardedPoints = 0;
    courseData.exercises.forEach((x) => {
        availablePoints += x.available_points.length;
        awardedPoints += x.awarded_points.length;
    });

    const localData: LocalCourseData = {
        description: courseData.details.description || "",
        exercises: courseData.details.exercises.map((e) => ({
            id: e.id,
            name: e.name,
            deadline: e.deadline,
            passed: e.completed,
            softDeadline: e.soft_deadline,
        })),
        id: courseData.details.id,
        name: courseData.details.name,
        title: courseData.details.title,
        organization: organization,
        availablePoints: availablePoints,
        awardedPoints: awardedPoints,
        perhapsExamMode: courseData.settings.hide_submission_results,
        newExercises: [],
        notifyAfter: 0,
        disabled: courseData.settings.disabled_status === "enabled" ? false : true,
        materialUrl: courseData.settings.material_url,
    };
    userData.addCourse(localData);
    ui.treeDP.addChildWithId("myCourses", localData.id, localData.title, {
        command: "tmc.courseDetails",
        title: "Go To Course Details",
        arguments: [localData.id],
    });
    workspaceManager.createWorkspaceFile(courseData.details.name);
    await displayUserCourses(actionContext);
    return refreshLocalExercises(actionContext);
}
