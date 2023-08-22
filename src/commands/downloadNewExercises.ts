import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { Logger } from "../utilities";

export async function downloadNewExercises(actionContext: ActionContext): Promise<void> {
    const { dialog, userData } = actionContext;
    Logger.info("Downloading new exercises");

    const courses = userData.getCourses();
    const courseId = await dialog.selectItem(
        "Download new exercises for course?",
        ...courses.map<[string, number]>((course) => [course.title, course.id]),
    );
    if (!courseId) {
        return;
    }

    const course = userData.getCourse(courseId);
    if (course.newExercises.length === 0) {
        dialog.notification(`There are no new exercises for the course ${course.title}.`, [
            "OK",
            (): void => {},
        ]);
        return;
    }

    const downloadResult = await actions.downloadNewExercisesForCourse(actionContext, courseId);
    if (downloadResult.err) {
        dialog.errorNotification(
            `Failed to download new exercises for course "${course.title}."`,
            downloadResult.val,
        );
    }
}
