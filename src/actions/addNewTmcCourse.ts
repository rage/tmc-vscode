import { Result } from "ts-results";

import { LocalTmcCourseData } from "../api/storage";
import { Logger } from "../utilities";
import { combineApiExerciseData } from "../utilities/apiData";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";

/**
 * Adds a new TMC course to user's courses.
 */
export async function addNewTmcCourse(
    actionContext: ActionContext,
    organization: string,
    course: number,
): Promise<Result<void, Error>> {
    const { tmc, ui, userData, workspaceManager } = actionContext;
    Logger.info("Adding new course");

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

    const localData: LocalTmcCourseData = {
        description: courseData.details.description || "",
        exercises: combineApiExerciseData(courseData.details.exercises, courseData.exercises),
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
    userData.addCourse({ kind: "tmc", data: localData });
    ui.treeDP.addChildWithId("myCourses", localData.id, localData.title, {
        command: "tmc.courseDetails",
        title: "Go To Course Details",
        arguments: [localData.id],
    });
    workspaceManager.createWorkspaceFile(courseData.details.name);
    //await displayUserCourses(actionContext);
    return refreshLocalExercises(actionContext);
}
