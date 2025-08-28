import { LocalCourseData } from "../api/storage";
import { Logger } from "../utilities";
import { combineApiExerciseData } from "../utilities/apiData";
import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";
import { Err, Result } from "ts-results";

/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(
    actionContext: ActionContext,
    organization: string,
    course: number,
): Promise<Result<void, Error>> {
    const { tmc, ui, userData, workspaceManager } = actionContext;
    if (!(tmc.ok && userData.ok && workspaceManager.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Adding new course");

    const courseDataResult = await tmc.val.getCourseData(course);
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
    userData.val.addCourse(localData);
    ui.treeDP.addChildWithId("myCourses", localData.id, localData.title, {
        command: "tmc.courseDetails",
        title: "Go To Course Details",
        arguments: [localData.id],
    });
    workspaceManager.val.createWorkspaceFile(courseData.details.name);
    //await displayUserCourses(actionContext);
    return refreshLocalExercises(actionContext);
}
