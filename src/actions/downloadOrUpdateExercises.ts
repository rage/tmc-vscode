import { Err, Ok, Result } from "ts-results";

import { TmcPanel } from "../panels/TmcPanel";
import { ExerciseIdentifier, ExtensionToWebview } from "../shared/shared";
import { ExerciseStatus } from "../ui/types";
import { Logger } from "../utilities";

import { ActionContext } from "./types";

interface DownloadResults {
    successful: ExerciseIdentifier[];
    failed: ExerciseIdentifier[];
}

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param exerciseIds Exercises to download.
 * @returns Exercise ids for successful downloads.
 */
export async function downloadOrUpdateExercises(
    actionContext: ActionContext,
    exerciseIds: ExerciseIdentifier[],
): Promise<Result<DownloadResults, Error>> {
    const { dialog, settings, langs } = actionContext;
    if (langs.err) {
        return new Err(new Error("Extension was not initialized properly"));
    }
    Logger.info("Downloading exercises", exerciseIds);

    if (exerciseIds.length === 0) {
        return Ok({ successful: [], failed: [] });
    }

    TmcPanel.postMessage(...exerciseIds.map((x) => wrapToMessage(x, "downloading")));
    const statuses = new Map<number | string, ExerciseStatus>(
        exerciseIds.map((x) => [ExerciseIdentifier.unwrap(x), "downloadFailed"]),
    );

    const downloadTemplate = !settings.getDownloadOldSubmission();
    const downloadResult = await dialog.progressNotification(
        "Downloading exercises...",
        (progress) => {
            return langs.val.downloadExercises(exerciseIds, downloadTemplate, (download) => {
                progress.report(download);
                statuses.set(ExerciseIdentifier.unwrap(download.id), "closed");
                TmcPanel.postMessage(wrapToMessage(download.id, "closed"));
            });
        },
    );
    if (downloadResult.err) {
        postMessages(statuses);
        return downloadResult;
    }

    const [
        { downloaded: tmcDownloaded, failed: tmcFailed, skipped: tmcSkipped },
        { downloaded: moocDownloaded, failed: moocFailed, skipped: moocSkipped },
    ] = downloadResult.val;
    if (tmcSkipped.length > 0) {
        Logger.warn(`${tmcSkipped.length} downloads were skipped.`);
    }
    if (moocSkipped.length > 0) {
        Logger.warn(`${moocSkipped.length} downloads were skipped.`);
    }
    tmcDownloaded.forEach((x) => statuses.set(x.id, "closed"));
    moocDownloaded.forEach((x) => statuses.set(x["task-id"], "closed"));
    tmcSkipped.forEach((x) => statuses.set(x.id, "closed"));
    moocSkipped.forEach((x) => statuses.set(x["task-id"], "closed"));
    tmcFailed?.forEach(([exercise, reason]) => {
        Logger.error(`Failed to download exercise ${exercise["exercise-slug"]}: ${reason}`);
        statuses.set(exercise.id, "downloadFailed");
    });
    moocFailed?.forEach(([exercise, reason]) => {
        Logger.error(`Failed to download exercise ${exercise["task-id"]}: ${reason}`);
        statuses.set(exercise["task-id"], "downloadFailed");
    });
    postMessages(statuses);
    if (tmcFailed && tmcFailed.length > 0) {
        const failedDownloads = tmcFailed.map(([f]) => f["exercise-slug"]);
        dialog.errorNotification(
            "Failed to update exercises.",
            new Error(failedDownloads.join(", ")),
        );
    }
    if (moocFailed && moocFailed.length > 0) {
        const failedDownloads = moocFailed.map(([f]) => f["task-id"]);
        dialog.errorNotification(
            "Failed to update exercises.",
            new Error(failedDownloads.join(", ")),
        );
    }

    return Ok(sortResults(statuses));
}

function postMessages(statuses: Map<number | string, ExerciseStatus>): void {
    TmcPanel.postMessage(
        ...Array.from(statuses.entries()).map(([id, s]) =>
            wrapToMessage(ExerciseIdentifier.from(id), s),
        ),
    );
}

function wrapToMessage(exerciseId: ExerciseIdentifier, status: ExerciseStatus): ExtensionToWebview {
    return {
        type: "exerciseStatusChange",
        target: {
            type: "CourseDetails",
        },
        exerciseId,
        status,
    };
}

function sortResults(statuses: Map<number | string, ExerciseStatus>): DownloadResults {
    const successful: ExerciseIdentifier[] = [];
    const failed: ExerciseIdentifier[] = [];
    statuses.forEach((status, id) => {
        if (status !== "downloadFailed") {
            successful.push(ExerciseIdentifier.from(id));
        } else {
            failed.push(ExerciseIdentifier.from(id));
        }
    });
    return { successful, failed };
}
