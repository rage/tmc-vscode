import * as actions from "../actions";
import { ActionContext, CourseExerciseDownloads } from "../actions/types";
import { Logger } from "../utils";
import { askForItem, showError, showNotification } from "../window";

export async function downloadNewExercises(actionContext: ActionContext): Promise<void> {
    const { userData } = actionContext;
    const downloadNewExercises = async (courseId: number): Promise<void> => {
        const course = userData.getCourse(courseId);
        if (course.newExercises.length === 0) {
            showNotification(`There are no new exercises for the course ${course.title}.`, [
                "OK",
                (): void => {},
            ]);
            return;
        }
        const downloads: CourseExerciseDownloads = {
            courseId: course.id,
            exerciseIds: course.newExercises,
            organizationSlug: course.organization,
            courseName: course.name,
        };
        const [successful] = await actions.downloadExercises(
            actionContext,
            course.newExercises.map((x) => ({
                courseId: course.id,
                exerciseId: x,
                organization: course.organization,
            })),
        );
        const successfulIds = successful.map((ex) => ex.exerciseId);
        await userData.clearFromNewExercises(courseId, successfulIds);
        const openResult = await actions.openExercises(
            actionContext,
            successfulIds,
            downloads.courseName,
        );
        if (openResult.err) {
            const message = "Failed to open exercises after download.";
            Logger.error(message, openResult.val);
            showError(message);
        }
    };

    const courses = userData.getCourses();
    const courseId = await askForItem<number>(
        "Download new exercises for course?",
        false,
        ...courses.map<[string, number]>((course) => [course.title, course.id]),
    );

    if (courseId) {
        await downloadNewExercises(courseId);
    }
}
