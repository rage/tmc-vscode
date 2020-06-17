import pLimit = require("p-limit");
import { Result } from "ts-results";

import { ActionContext, CourseExerciseDownloads } from "./types";
import { showError } from "../utils";

/**
 * Downloads given exercises and opens them in TMC workspace.
 * @deprecated
 */
export async function downloadExercises(
    actionContext: ActionContext,
    courseExerciseDownloads: CourseExerciseDownloads[],
    returnToCourse?: number,
): Promise<void> {
    const { tmc, ui, logger, workspaceManager } = actionContext;

    const exerciseStatus = new Map<
        number,
        {
            name: string;
            organizationSlug: string;
            downloaded: boolean;
            failed: boolean;
            error: string;
            status: string;
        }
    >();

    for (const ced of courseExerciseDownloads) {
        const courseDetails = await tmc.getCourseDetails(ced.courseId);
        if (courseDetails.ok) {
            courseDetails.val.course.exercises
                .filter((x) => ced.exerciseIds.includes(x.id))
                .forEach((x) =>
                    exerciseStatus.set(x.id, {
                        name: x.name,
                        organizationSlug: ced.organizationSlug,
                        downloaded: false,
                        failed: false,
                        error: "",
                        status: "In queue",
                    }),
                );
        } else {
            const message = `Could not download exercises, course details not found: ${courseDetails.val.name} - ${courseDetails.val.message}`;
            logger.log(message);
            showError(message);
        }
    }

    const downloadCount = exerciseStatus.size;
    let successful = 0;
    let failed = 0;

    ui.webview.setContentFromTemplate({
        templateName: "downloading-exercises",
        returnToCourse,
        exercises: Array.from(exerciseStatus.values()),
        failed,
        failedPct: Math.round((100 * failed) / downloadCount),
        remaining: downloadCount - successful - failed,
        successful,
        successfulPct: Math.round((100 * successful) / downloadCount),
        total: downloadCount,
    });

    const limit = pLimit(3);
    const openExercises: Array<number> = [];

    await Promise.all(
        Array.from(exerciseStatus.entries()).map<Promise<Result<void, Error>>>(([id, data]) =>
            limit(
                () =>
                    new Promise((resolve) => {
                        if (data) {
                            if (workspaceManager.isExerciseOpen(id)) {
                                openExercises.push(id);
                            }
                            data.status = "Downloading";
                            exerciseStatus.set(id, data);
                            ui.webview.setContentFromTemplate({
                                templateName: "downloading-exercises",
                                returnToCourse,
                                exercises: Array.from(exerciseStatus.values()),
                                failed,
                                failedPct: Math.round((100 * failed) / downloadCount),
                                remaining: downloadCount - successful - failed,
                                successful,
                                successfulPct: Math.round((100 * successful) / downloadCount),
                                total: downloadCount,
                            });
                        }

                        tmc.downloadExercise(id, data.organizationSlug).then(
                            (res: Result<void, Error>) => {
                                if (data) {
                                    if (res.ok) {
                                        successful += 1;
                                        data.downloaded = true;
                                    } else {
                                        failed += 1;
                                        data.failed = true;
                                        data.error = res.val.message;
                                    }
                                    exerciseStatus.set(id, data);
                                    ui.webview.setContentFromTemplate({
                                        templateName: "downloading-exercises",
                                        returnToCourse,
                                        exercises: Array.from(exerciseStatus.values()),
                                        failed,
                                        failedPct: Math.round((100 * failed) / downloadCount),
                                        remaining: downloadCount - successful - failed,
                                        successful,
                                        successfulPct: Math.round(
                                            (100 * successful) / downloadCount,
                                        ),
                                        total: downloadCount,
                                    });
                                }
                                resolve(res);
                            },
                        );
                    }),
            ),
        ),
    );
    workspaceManager.openExercise(...openExercises);
}
