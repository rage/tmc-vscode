import { concat, flatten, groupBy, partition } from "lodash";
import * as pLimit from "p-limit";
import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import { WebviewMessage } from "../ui/types";
import { incrementPercentageWrapper } from "../window";

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
    const { tmc, ui, userData } = actionContext;

    // TODO: How to download latest submission in new version?
    const downloadResult = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "TestMyCode",
        },
        (progress) => {
            const progress2 = incrementPercentageWrapper(progress);
            return limit(() =>
                tmc.downloadExercises(exerciseIds, (download) => {
                    progress2.report(download);
                    ui.webview.postMessage({
                        command: "exerciseStatusChange",
                        exerciseId: download.id,
                        status: "closed",
                    });
                }),
            );
        },
    );
    if (downloadResult.err) {
        return downloadResult;
    }

    // Some code still treats exercises by their ids, so return those instead.
    // Uuunfortunately.
    const successfulSlugs = concat(downloadResult.val.downloaded, downloadResult.val.skipped);
    const successfulByCourse = groupBy(successfulSlugs, (x) => x["course-slug"]);
    const successfulIdsByCourse = Object.keys(successfulByCourse).map<number[]>((course) => {
        const downloadedSlugs = new Set(successfulByCourse[course].map((x) => x["exercise-slug"]));
        return userData
            .getCourseByName(course)
            .exercises.filter((x) => downloadedSlugs.has(x.name))
            .map((x) => x.id);
    });
    const successfulIds = new Set(flatten(successfulIdsByCourse));
    const [successful, failed] = partition(exerciseIds, (x) => successfulIds.has(x));

    ui.webview.postMessage(
        ...successful.map<WebviewMessage>((x) => ({
            command: "exerciseStatusChange",
            exerciseId: x,
            status: "opened",
        })),
        ...failed.map<WebviewMessage>((x) => ({
            command: "exerciseStatusChange",
            exerciseId: x,
            status: "closed",
        })),
    );

    return Ok({ successful, failed });
}
