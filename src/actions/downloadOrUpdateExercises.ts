import * as pLimit from "p-limit";
import { Ok, Result } from "ts-results";

import { ExerciseStatus, WebviewMessage } from "../ui/types";
import TmcWebview from "../ui/webview";
import { Logger } from "../utils";

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
    const { dialog, settings, tmc, ui } = actionContext;
    if (exerciseIds.length === 0) {
        return Ok({ successful: [], failed: [] });
    }

    ui.webview.postMessage(...exerciseIds.map((x) => wrapToMessage(x, "downloading")));
    const statuses = new Map<number, ExerciseStatus>(exerciseIds.map((x) => [x, "downloadFailed"]));

    const downloadTemplate = !settings.getDownloadOldSubmission();
    const downloadResult = await dialog.progressNotification(
        "Downloading exercises...",
        (progress) =>
            limit(() =>
                tmc.downloadExercises(exerciseIds, downloadTemplate, (download) => {
                    progress.report(download);
                    statuses.set(download.id, "closed");
                    ui.webview.postMessage(wrapToMessage(download.id, "closed"));
                }),
            ),
    );
    if (downloadResult.err) {
        postMessages(ui.webview, statuses);
        return downloadResult;
    }

    const { downloaded, failed, skipped } = downloadResult.val;
    skipped.length > 0 && Logger.warn(`${skipped.length} downloads were skipped.`);
    downloaded.forEach((x) => statuses.set(x.id, "opened"));
    skipped.forEach((x) => statuses.set(x.id, "closed"));
    failed?.forEach(([exercise, reason]) => {
        Logger.error(`Failed to download exercise ${exercise["exercise-slug"]}: ${reason}`);
        statuses.set(exercise.id, "downloadFailed");
    });
    postMessages(ui.webview, statuses);

    return Ok(sortResults(statuses));
}

function postMessages(webview: TmcWebview, statuses: Map<number, ExerciseStatus>): void {
    webview.postMessage(...Array.from(statuses.entries()).map(([id, s]) => wrapToMessage(id, s)));
}

function wrapToMessage(exerciseId: number, status: ExerciseStatus): WebviewMessage {
    return {
        command: "exerciseStatusChange",
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
