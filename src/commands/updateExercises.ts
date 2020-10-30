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
    const updateResults = await actions.checkForExerciseUpdates(actionContext, undefined, {
        useCache: false,
    });

    const [successful, failed] = updateResults.reduce<[CourseExerciseDownloads[], Error[]]>(
        (sorted, next) => {
            if (next.ok) {
                return [sorted[0].concat(next.val), sorted[1]];
            } else {
                return [sorted[0], sorted[1].concat(next.val)];
            }
        },
        [[], []],
    );

    if (failed.length > 0) {
        Logger.warn("Failed to check updates for some courses.");
        failed.forEach((x) => Logger.debug("Update failed: ", x));
        silent !== "silent" && showError("Failed to check updates for some courses.");
    }

    const now = Date.now();
    const filtered = successful.filter((x) => {
        const course = userData.getCourse(x.courseId);
        return x.exerciseIds.length > 0 && course.notifyAfter <= now && !course.disabled;
    });

    const updates = _.sumBy(filtered, (x) => x.exerciseIds.length);
    if (updates === 0) {
        silent !== "silent" && showNotification("All exercises are up to date.");
        return;
    }

    const exercises = _.flatten(
        filtered.map((x) =>
            x.exerciseIds.map((e) => ({
                courseId: x.courseId,
                exerciseId: e,
                organization: x.organizationSlug,
            })),
        ),
    );

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
                filtered.forEach((x) =>
                    userData.setNotifyDate(x.courseId, now2 + NOTIFICATION_DELAY),
                );
            },
        ],
    );
}
