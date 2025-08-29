import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { NOTIFICATION_DELAY } from "../config/constants";
import { TmcPanel } from "../panels/TmcPanel";
import { ExtensionToWebview } from "../shared/shared";
import { Logger } from "../utilities";
import { uniq } from "lodash";

export async function updateExercises(actionContext: ActionContext, silent: string): Promise<void> {
    const { dialog, settings, userData } = actionContext;
    Logger.info("Checking for exercise updates");
    if (userData.err) {
        Logger.error("Extension was not initialized properly");
        return;
    }

    const updateablesResult = await actions.checkForExerciseUpdates(actionContext);
    if (updateablesResult.err) {
        Logger.warn("Failed to check for exercise updates.", updateablesResult.val);
        if (silent !== "silent") {
            dialog.errorNotification("Failed to check for exercise updates.");
        }
        return;
    }

    const now = Date.now();
    const exercisesToUpdate = updateablesResult.val.filter((x) => {
        const course = userData.val.getCourse(x.courseId);
        return course.notifyAfter <= now && !course.disabled;
    });

    if (exercisesToUpdate.length === 0) {
        if (silent !== "silent") {
            dialog.notification("All exercises are up to date.");
        }
        return;
    }

    const downloadHandler = async (): Promise<void> => {
        TmcPanel.postMessage(
            ...userData.val.getCourses().map<ExtensionToWebview>((x) => ({
                type: "setUpdateables",
                target: { type: "CourseDetails" },
                courseId: x.id,
                exerciseIds: [],
            })),
        );
        const downloadResult = await actions.downloadOrUpdateExercises(
            actionContext,
            exercisesToUpdate.map((x) => x.exerciseId),
        );
        if (downloadResult.err) {
            dialog.errorNotification("Failed to update exercises.", downloadResult.val);
            return;
        }

        TmcPanel.postMessage(
            ...userData.val.getCourses().map<ExtensionToWebview>((x) => ({
                type: "setUpdateables",
                target: { type: "CourseDetails" },
                courseId: x.id,
                exerciseIds: downloadResult.val.failed,
            })),
        );
    };

    if (settings.getAutomaticallyUpdateExercises()) {
        return downloadHandler();
    }

    dialog.notification(
        `Found updates for ${exercisesToUpdate.length} exercises. Do you wish to download them?`,
        ["Download", downloadHandler],
        [
            "Remind me later",
            async (): Promise<void> => {
                const now2 = Date.now();
                const uniqueCourseIds = uniq(exercisesToUpdate.map((x) => x.courseId));
                uniqueCourseIds.forEach((x) =>
                    userData.val.setNotifyDate(x, now2 + NOTIFICATION_DELAY),
                );
            },
        ],
    );
}
