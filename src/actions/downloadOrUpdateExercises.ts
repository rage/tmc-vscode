import { partition } from "lodash";
import * as pLimit from "p-limit";
import { Ok, Result } from "ts-results";

import { ExerciseStatus, WebviewMessage } from "../ui/types";
import { Logger } from "../utils";

import { ActionContext } from "./types";

// Use this until using Langs version with file locks
const limit = pLimit(1);

/**
 * Downloads given exercises and opens them in TMC workspace.
 *
 * @param exerciseIds Exercises to download.
 * @returns Exercise ids for successful downloads.
 */
export async function downloadOrUpdateExercises(
    actionContext: ActionContext,
    exerciseIds: number[],
): Promise<Result<{ successful: number[]; failed: number[] }, Error>> {
    const { dialog, tmc, ui } = actionContext;
    if (exerciseIds.length === 0) {
        return Ok({ successful: [], failed: [] });
    }

    ui.webview.postMessage(...exerciseIds.map((x) => wrapToMessage(x, "downloading")));

    // TODO: How to download latest submission in new version?
    const downloadResult = await dialog.progressNotification(
        "Downloading exercises...",
        (progress) =>
            limit(() =>
                tmc.downloadExercises(exerciseIds, (download) => {
                    progress.report(download);
                    ui.webview.postMessage(wrapToMessage(download.id, "closed"));
                }),
            ),
    );

    return downloadResult.andThen(({ downloaded, failed, skipped }) => {
        skipped.length > 0 && Logger.warn(`${skipped.length} downloads were skipped.`);
        const resultMap = new Map<number, ExerciseStatus>(
            exerciseIds.map((x) => [x, "downloadFailed"]),
        );
        downloaded.forEach((x) => resultMap.set(x.id, "closed"));
        skipped.forEach((x) => resultMap.set(x.id, "closed"));
        failed?.forEach((x) => {
            Logger.error(`Failed to download exercise ${x[0]["exercise-slug"]}: ${x[1]}`);
            resultMap.set(x[0].id, "downloadFailed");
        });
        const entries = Array.from(resultMap.entries());
        ui.webview.postMessage(
            ...entries.map<WebviewMessage>(([id, status]) => wrapToMessage(id, status)),
        );
        const [successfulIds, failedIds] = partition(
            entries,
            ([, status]) => status !== "downloadFailed",
        );
        return Ok({
            successful: successfulIds.map((x) => x[0]),
            failed: failedIds.map((x) => x[0]),
        });
    });
}

function wrapToMessage(exerciseId: number, status: ExerciseStatus): WebviewMessage {
    return {
        command: "exerciseStatusChange",
        exerciseId,
        status,
    };
}
