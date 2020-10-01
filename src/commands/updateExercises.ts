import * as _ from "lodash";

import * as actions from "../actions";
import { ActionContext, CourseExerciseDownloads } from "../actions/types";
import { NOTIFICATION_DELAY } from "../config/constants";
import { Logger } from "../utils";
import { showError, showNotification } from "../window";

export async function updateExercises(actionContext: ActionContext, silent: string): Promise<void> {
    Logger.log("Checking for exercise updates");
    const { settings, userData } = actionContext;
    const updateResults = await actions.checkForExerciseUpdates(actionContext, undefined);

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
        const [, failed] = await actions.downloadExerciseUpdates(actionContext, exercises);
        if (failed.length > 0) {
            Logger.error("Failed to update exercises", failed[0]);
            showError("Failed to update exercises.");
        }
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
