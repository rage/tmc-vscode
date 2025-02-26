import { Result } from "ts-results";

import { LocalMoocCourseData } from "../api/storage";
import { Logger } from "../utilities";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";

/**
 * Adds a new MOOC course to user's courses.
 */
export async function addNewMoocCourse(
    actionContext: ActionContext,
    courseId: string,
    instanceId: string,
    courseName: string,
    instanceName: string | null,
): Promise<Result<void, Error>> {
    const { ui, userData, workspaceManager } = actionContext;
    Logger.info("Adding new course");

    const localData: LocalMoocCourseData = {
        courseId,
        instanceId,
        courseName,
        instanceName,
    };
    userData.addMoocCourse(localData);
    ui.treeDP.addChildWithId("myCourses", localData.courseId, localData.courseName, {
        command: "tmc.courseDetails",
        title: "Go To Course Details",
        arguments: [localData.courseId],
    });
    workspaceManager.createWorkspaceFile(`${courseId}_${instanceId}`);
    //await displayUserCourses(actionContext);
    return refreshLocalExercises(actionContext);
}
