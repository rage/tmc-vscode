import * as fs from "fs";
import * as fetch from "node-fetch";
import * as path from "path";
import * as vscode from "vscode";

import { Err, Ok, Result } from "ts-results";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import { ConnectionError } from "../errors";
import { SubmissionFeedbackQuestion } from "../api/types";
import { FeedbackQuestion } from "../actions/types";
import ClientOAuth2 = require("client-oauth2");
import { LocalExerciseData } from "../config/types";
import { superfluousPropertiesEnabled } from "./env";

/**
 * Downloads data from given url to the specified file. If file exists, its content will be overwritten.
 * @param url Url to data
 * @param filePath Absolute path to the desired output file
 * @param headers Request headers if any
 */
export async function downloadFile(
    url: string,
    filePath: string,
    headers?: { [key: string]: string },
    authToken?: ClientOAuth2.Token,
    progressCallback?: (downloadedPct: number, increment: number) => void,
): Promise<Result<void, Error>> {
    fs.mkdirSync(path.resolve(filePath, ".."), { recursive: true });

    let response: fetch.Response;
    try {
        let request = { url, method: "get", headers };
        if (authToken) {
            request = authToken.sign(request);
        }
        response = await fetch.default(request.url, request);
        const sizeString = response.headers.get("content-length");
        if (sizeString && progressCallback) {
            let downloaded = 0;
            const size = parseInt(sizeString, 10);
            response.body.on("data", (chunk: Buffer) => {
                downloaded += chunk.length;
                progressCallback(
                    Math.round((downloaded / size) * 100),
                    (100 * chunk.length) / size,
                );
            });
        }
    } catch (error) {
        return new Err(new ConnectionError("Connection error: " + error.name));
    }

    if (!response.ok) {
        return new Err(new Error("Request failed: " + response.statusText));
    }

    try {
        await new Promise((resolve, reject) =>
            response.buffer().then((buffer) => {
                fs.writeFile(filePath, buffer, (err) => (err ? reject(err) : resolve()));
            }),
        );
    } catch (error) {
        return new Err(new Error("Writing to file failed: " + error));
    }

    return Ok.EMPTY;
}

export function isWorkspaceOpen(resources: Resources): boolean {
    const currentWorkspaceFile = vscode.workspace.workspaceFile;
    const tmcWorkspaceFile = vscode.Uri.file(resources.getWorkspaceFilePath());
    return currentWorkspaceFile?.toString() === tmcWorkspaceFile.toString();
}

/**
 * Await this to pause execution for an amount of time
 * @param millis
 */
export function sleep(millis: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, millis));
}

/**
 * Convert Chars to a string
 * @param array Char numbers array
 */
export function numbersToString(array: number[]): string {
    return String.fromCharCode(...array);
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
 * Get the Exercise ID for the currently open text editor
 */
export function getCurrentExerciseId(workspaceManager: WorkspaceManager): number | undefined {
    const editorPath = vscode.window.activeTextEditor?.document.fileName;
    if (!editorPath) {
        return undefined;
    }
    return workspaceManager.getExercisePath(editorPath);
}

/**
 * Get the Exercise data for the currently open text editor
 */
export function getCurrentExerciseData(
    workspaceManager: WorkspaceManager,
): Result<LocalExerciseData, Error> {
    const id = getCurrentExerciseId(workspaceManager);
    if (!id) {
        return new Err(new Error("Currently open editor is not part of a TMC exercise"));
    }
    return workspaceManager.getExerciseDataById(id);
}

/**
 * Return bootstrap striped, animated progress bar div as string
 * @param percentDone How much done of the progress
 */
export function getProgressBar(percentDone: number): string {
    return `<div class="progress">
        <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" aria-valuenow="${percentDone}" aria-valuemin="0" aria-valuemax="100" style="width: ${percentDone}%"></div>
    </div>`;
}

export function displayProgrammerError(description: string): void {
    vscode.window.showErrorMessage(
        (superfluousPropertiesEnabled() ? "" : "Programmer ") + "Error: " + description,
    );
}

export function parseFeedbackQuestion(questions: SubmissionFeedbackQuestion[]): FeedbackQuestion[] {
    const feedbackQuestions: FeedbackQuestion[] = [];
    questions.forEach((x) => {
        const kindRangeMatch = x.kind.match("intrange\\[(-?[0-9]+)..(-?[0-9]+)\\]");
        if (kindRangeMatch && kindRangeMatch[0] === x.kind) {
            feedbackQuestions.push({
                id: x.id,
                kind: "intrange",
                lower: parseInt(kindRangeMatch[1], 10),
                question: x.question,
                upper: parseInt(kindRangeMatch[2], 10),
            });
        } else if (x.kind === "text") {
            feedbackQuestions.push({
                id: x.id,
                kind: "text",
                question: x.question,
            });
        } else {
            console.log("Unexpected feedback question type:", x.kind);
        }
    });
    return feedbackQuestions;
}
