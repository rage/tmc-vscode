import { Err, Result } from "ts-results";

import { Logger } from "../utilities";
import { combineTmcApiExerciseData } from "../utilities/apiData";

import { refreshLocalExercises } from "./refreshLocalExercises";
import { ActionContext } from "./types";
import { CourseIdentifier, LocalMoocCourseData, LocalTmcCourseData, match } from "../shared/shared";

/**
 * Adds a new course to user's courses.
 */
export async function addNewCourse(
    actionContext: ActionContext,
    organizationSlug: string,
    course: CourseIdentifier,
): Promise<Result<void, Error>> {
    const { langs, ui, userData, workspaceManager } = actionContext;
    if (!(langs.ok && userData.ok && workspaceManager.ok)) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Adding new course");

    return match(
        course,
        async (tmcCourse) => {
            const courseDataResult = await langs.val.getTmcCourseData(tmcCourse.courseId);
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
                exercises: combineTmcApiExerciseData(
                    courseData.details.exercises,
                    courseData.exercises,
                ),
                id: courseData.details.id,
                name: courseData.details.name,
                title: courseData.details.title,
                organization: organizationSlug,
                availablePoints: availablePoints,
                awardedPoints: awardedPoints,
                perhapsExamMode: courseData.settings.hide_submission_results,
                newExercises: [],
                notifyAfter: 0,
                disabled: courseData.settings.disabled_status === "enabled" ? false : true,
                materialUrl: courseData.settings.material_url,
            };
            userData.val.addCourse({ kind: "tmc", data: localData });
            ui.treeDP.addChildWithId("myCourses", localData.id, localData.title, {
                command: "tmc.courseDetails",
                title: "Go To Course Details",
                arguments: [CourseIdentifier.from(localData.id)],
            });
            workspaceManager.val.createWorkspaceFile(courseData.details.name);
            //await displayUserCourses(actionContext);
            return refreshLocalExercises(actionContext);
        },
        async (mooc) => {
            const courseInstanceRes = await langs.val.getMoocCourseInstanceData(mooc.instanceId);
            if (courseInstanceRes.err) {
                return courseInstanceRes;
            }
            const [courseInstance, _] = courseInstanceRes.val;

            const localData: LocalMoocCourseData = {
                courseId: courseInstance.course_id,
                instanceId: courseInstance.id,
                courseName: courseInstance.course_name,
                instanceName: courseInstance.instance_name,
                courseDescription: courseInstance.course_description,
                instanceDescription: courseInstance.instance_description,
                awardedPoints: 0,
                availablePoints: 0,
                disabled: false,
                materialUrl: null,
                exercises: [],
                newExercises: [],
                notifyAfter: 0,
                perhapsExamMode: false,
            };
            userData.val.addCourse({ kind: "mooc", data: localData });
            ui.treeDP.addChildWithId("myCourses", localData.instanceId, localData.courseName, {
                command: "tmc.courseDetails",
                title: "Go To Course Details",
                arguments: [CourseIdentifier.from(localData.instanceId)],
            });
            workspaceManager.val.createWorkspaceFile(courseInstance.course_slug);
            return refreshLocalExercises(actionContext);
        },
    );
}
