/* eslint-disable @typescript-eslint/no-unused-vars */
import * as _ from "lodash";

import * as actions from "../actions";
import { ActionContext, CourseExerciseDownloads } from "../actions/types";
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
    const filteredExercises = updateablesResult.val.filter((x) => {
        const course = userData.getCourse(x.courseId);
        return course.notifyAfter <= now && !course.disabled;
    });

    if (filteredExercises.length === 0) {
        silent !== "silent" && showNotification("All exercises are up to date.");
        return;
    }

    // TODO: Reimplement downloadExerciseUpdates

    /*
    const downloadHandler = async (): Promise<void> => {
        ui.webview.postMessage(
            ...userData.getCourses().map<WebviewMessage>((x) => ({
                command: "setUpdateables",
                courseId: x.id,
                exerciseIds: [],
            })),
        );
        const [, failed] = await actions.downloadExerciseUpdates(actionContext, exercises);
        if (failed.length > 0) {
            Logger.error("Failed to update exercises", failed[0]);
            showError("Failed to update exercises.");
        }

        const failedCoursesToExercises = _.groupBy(failed, (x) => x.courseId);
        const messages: WebviewMessage[] = Object.keys(failedCoursesToExercises).map((key) => ({
            command: "setUpdateables",
            courseId: parseInt(key),
            exerciseIds: failedCoursesToExercises[key].map((x) => x.exerciseId),
        }));
        Logger.debug(messages);
        ui.webview.postMessage(...messages);
    };

    if (settings.getAutomaticallyUpdateExercises()) {
        return downloadHandler();
    }

    showNotification(
        `Found updates for ${updates} exercises. Do you wish to download them?`,
        ["Download", downloadHandler],
        [
            "Remind me later",
            async (): Promise<void> => {
                const now2 = Date.now();
                filteredExercises.forEach((x) =>
                    userData.setNotifyDate(x.courseId, now2 + NOTIFICATION_DELAY),
                );
            },
        ],
    );
    */
}
