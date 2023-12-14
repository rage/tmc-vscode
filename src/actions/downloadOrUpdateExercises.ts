import pLimit from "p-limit";
import { Ok, Result } from "ts-results";

import { TmcPanel } from "../panels/TmcPanel";
import { ExtensionToWebview } from "../shared/shared";
import { ExerciseStatus } from "../ui/types";
import { Logger } from "../utilities";

import { ActionContext } from "./types";

// Use this until using Langs version with file locks
const limit = pLimit(1);

interface DownloadResults {
    successful: number[];
    failed: number[];
}

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param exerciseIds Exercises to download.
 * @returns Exercise ids for successful downloads.
 */
export async function downloadOrUpdateExercises(
    actionContext: ActionContext,
    exerciseIds: number[],
): Promise<Result<DownloadResults, Error>> {
    const { dialog, settings, tmc } = actionContext;
    Logger.info("Downloading exercises", exerciseIds);

    if (exerciseIds.length === 0) {
        return Ok({ successful: [], failed: [] });
    }

    TmcPanel.postMessage(...exerciseIds.map((x) => wrapToMessage(x, "downloading")));
    const statuses = new Map<number, ExerciseStatus>(exerciseIds.map((x) => [x, "downloadFailed"]));

    const downloadTemplate = !settings.getDownloadOldSubmission();
    const downloadResult = await dialog.progressNotification(
        "Downloading exercises...",
        (progress) =>
            limit(() =>
                tmc.downloadExercises(exerciseIds, downloadTemplate, (download) => {
                    progress.report(download);
                    statuses.set(download.id, "closed");
                    TmcPanel.postMessage(wrapToMessage(download.id, "closed"));
                }),
            ),
    );
    if (downloadResult.err) {
        postMessages(statuses);
        return downloadResult;
    }

    const { downloaded, failed, skipped } = downloadResult.val;
    skipped.length > 0 && Logger.warn(`${skipped.length} downloads were skipped.`);
    downloaded.forEach((x) => statuses.set(x.id, "closed"));
    skipped.forEach((x) => statuses.set(x.id, "closed"));
    failed?.forEach(([exercise, reason]) => {
        Logger.error(`Failed to download exercise ${exercise["exercise-slug"]}: ${reason}`);
        statuses.set(exercise.id, "downloadFailed");
    });
    postMessages(statuses);
    if (failed && failed.length > 0) {
        const failedDownloads = failed.map(([f]) => f["exercise-slug"]);
        dialog.errorNotification(
            "Failed to update exercises.",
            new Error(failedDownloads.join(", ")),
        );
    }

    return Ok(sortResults(statuses));
}

function postMessages(statuses: Map<number, ExerciseStatus>): void {
    TmcPanel.postMessage(...Array.from(statuses.entries()).map(([id, s]) => wrapToMessage(id, s)));
}

function wrapToMessage(exerciseId: number, status: ExerciseStatus): ExtensionToWebview {
    return {
        type: "exerciseStatusChange",
        target: {
            type: "CourseDetails",
        },
        exerciseId,
        status,
    };
}

function sortResults(statuses: Map<number, ExerciseStatus>): DownloadResults {
    const successful: number[] = [];
    const failed: number[] = [];
    statuses.forEach((status, id) => {
        if (status !== "downloadFailed") {
            successful.push(id);
        } else {
            failed.push(id);
        }
    });
    return { successful, failed };
}
