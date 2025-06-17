import * as fs from "fs-extra";
import * as path from "path";
import { Err, Ok, Result } from "ts-results";
import { fetch, Response } from "undici";

import { FeedbackQuestion } from "../actions/types";
import { ConnectionError } from "../errors";
import { SubmissionFeedbackQuestion } from "../shared/langsSchema";

import { Logger } from "./logger";
import { ExtensionContext } from "vscode";

/**
 * Downloads data from given url to the specified file. If file exists, its content will be
 * overwritten.
 *
 * @param url Url to data
 * @param filePath Absolute path to the desired output file
 * @param headers Request headers if any
 */
export async function downloadFile(
    url: string,
    filePath: string,
    headers?: { [key: string]: string },
    progressCallback?: (downloadedPct: number, increment: number) => void,
): Promise<Result<void, Error>> {
    fs.mkdirSync(path.resolve(filePath, ".."), { recursive: true });

    let response: Response;
    try {
        const request = { url, method: "get", headers };
        response = await fetch(request.url, request);
    } catch (error) {
        Logger.error(error);
        // Typing change from update
        return new Err(new ConnectionError(error));
    }

    if (!response.ok) {
        return new Err(new Error("Request failed: " + response.statusText));
    }

    try {
        const file = await fs.createWriteStream(filePath);
        if (response.body) {
            let downloaded = 0;
            const sizeString = response.headers.get("content-length");
            const size = sizeString ? parseInt(sizeString, 10) : 0;
            for await (const chunk of response.body) {
                if (sizeString && progressCallback) {
                    downloaded += chunk.length;
                    progressCallback(
                        Math.round((downloaded / size) * 100),
                        (100 * chunk.length) / size,
                    );
                }
                await file.write(chunk);
            }
            await file.close();
        } else {
            throw new Error("Unexpected null response body");
        }
    } catch (error) {
        Logger.error(error);
        return new Err(new Error("Writing to file failed: " + error));
    }

    return Ok.EMPTY;
}

/**
 * Await this to pause execution for an amount of time
 * @param millis
 */
export function sleep(millis: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, millis));
}

export function formatSizeInBytes(size: number, precision = 3): string {
    let suffix = "B";
    let cSize = size;
    const targetPrecision = Math.min(
        size === 0 ? 1 : Math.floor(Math.log10(size) + 1),
        21,
        precision,
    );

    for (const s of ["kB", "MB", "GB", "TB", "EB"]) {
        if (Number.parseFloat(cSize.toPrecision(targetPrecision)) >= 1000) {
            cSize /= 1000;
            suffix = s;
        } else {
            break;
        }
    }

    return `${cSize.toPrecision(targetPrecision)} ${suffix}`;
}

/**
 * Return bootstrap striped, animated progress bar div as string
 * @param percentDone How much done of the progress
 */
export function getProgressBar(percentDone: number): string {
    return `<div class="progress">
        <div
            class="progress-bar progress-bar-striped progress-bar-animated"
            role="progressbar"
            aria-valuenow="${percentDone}"
            aria-valuemin="0"
            aria-valuemax="100"
            style="width: ${percentDone}%"
        ></div>
    </div>`;
}

export function parseFeedbackQuestion(questions: SubmissionFeedbackQuestion[]): FeedbackQuestion[] {
    const feedbackQuestions: FeedbackQuestion[] = [];
    questions.forEach((x) => {
        if (x.kind === "Text") {
            feedbackQuestions.push({
                id: x.id,
                kind: "text",
                question: x.question,
            });
        } else if (x.kind.IntRange) {
            feedbackQuestions.push({
                id: x.id,
                kind: "intrange",
                lower: x.kind.IntRange.lower,
                question: x.question,
                upper: x.kind.IntRange.upper,
            });
        } else {
            Logger.info("Unexpected feedback question type:", x.kind);
        }
    });
    return feedbackQuestions;
}

export function parseTestResultsText(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/`/g, "&#96;");
}

/**
 * Tries to remove old data if extension restarted within 10 minutes of moving TMC Data and
 * receiving error that some data could not be removed and has to be removed manually.
 * @param oldDataObject
 */
export async function removeOldData(oldDataObject: {
    path: string;
    timestamp: number;
}): Promise<Result<string, Error>> {
    if (oldDataObject.timestamp + 10 * 60 * 1000 > Date.now()) {
        try {
            fs.removeSync(oldDataObject.path);
        } catch (_err) {
            return new Err(new Error(`Still failed to remove data from ${oldDataObject.path}`));
        }
        return new Ok(`Removed successfully from ${oldDataObject.path}`);
    }
    return new Ok(`Time exceeded, will not remove data from ${oldDataObject.path}`);
}

export function cliFolder(context: ExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, "cli");
}
