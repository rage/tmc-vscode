import { uniq } from "lodash";

import * as actions from "../actions";
import { ActionContext } from "../actions/types";
import { NOTIFICATION_DELAY } from "../config/constants";
import { WebviewMessage } from "../ui/types";
import { Logger } from "../utils";
import { showError, showNotification } from "../window";

export async function updateExercises(actionContext: ActionContext, silent: string): Promise<void> {
    Logger.log("Checking for exercise updates");
    const { settings, ui, userData } = actionContext;

    const updateablesResult = await actions.checkForExerciseUpdates(actionContext);
    if (updateablesResult.err) {
        Logger.warn("Failed to check for exercise updates.", updateablesResult.val);
        silent !== "silent" && showError("Failed to check for exercise updates.");
        return;
    }

    const now = Date.now();
    const exercisesToUpdate = updateablesResult.val.filter((x) => {
        const course = userData.getCourse(x.courseId);
        return course.notifyAfter <= now && !course.disabled;
    });

    if (exercisesToUpdate.length === 0) {
        silent !== "silent" && showNotification("All exercises are up to date.");
        return;
    }

    const downloadHandler = async (): Promise<void> => {
        ui.webview.postMessage(
            ...userData.getCourses().map<WebviewMessage>((x) => ({
                command: "setUpdateables",
                courseId: x.id,
                exerciseIds: [],
            })),
        );
        const downloadResult = await actions.downloadOrUpdateExercises(
            actionContext,
            exercisesToUpdate.map((x) => x.exerciseId),
        );
        if (downloadResult.err) {
            Logger.error("Failed to update exercises", downloadResult.val);
            showError("Failed to update exercises.");
            return;
        }

        ui.webview.postMessage(
            ...userData.getCourses().map<WebviewMessage>((x) => ({
                command: "setUpdateables",
                courseId: x.id,
                exerciseIds: downloadResult.val.failed,
            })),
        );
    };

    if (settings.getAutomaticallyUpdateExercises()) {
        return downloadHandler();
    }

    showNotification(
        `Found updates for ${exercisesToUpdate.length} exercises. Do you wish to download them?`,
        ["Download", downloadHandler],
        [
            "Remind me later",
            async (): Promise<void> => {
                const now2 = Date.now();
                const uniqueCourseIds = uniq(exercisesToUpdate.map((x) => x.courseId));
                uniqueCourseIds.forEach((x) =>
                    userData.setNotifyDate(x, now2 + NOTIFICATION_DELAY),
                );
            },
        ],
    );
}
