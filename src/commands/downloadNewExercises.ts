import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { askForItem, showError, showNotification } from "../window";

export async function downloadNewExercises(actionContext: ActionContext): Promise<void> {
    const { userData } = actionContext;

    const courses = userData.getCourses();
    const courseId = await askForItem<number>(
        "Download new exercises for course?",
        false,
        ...courses.map<[string, number]>((course) => [course.title, course.id]),
    );
    if (!courseId) {
        return;
    }

    const course = userData.getCourse(courseId);
    if (course.newExercises.length === 0) {
        showNotification(`There are no new exercises for the course ${course.title}.`, [
            "OK",
            (): void => {},
        ]);
        return;
    }

    const downloadResult = await actions.downloadNewExercisesForCourse(actionContext, courseId);
    if (downloadResult.err) {
        showError(`Failed to download new exercises for course "${course.title}."`);
    }
}
