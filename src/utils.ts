import * as fs from "fs";
import * as fetch from "node-fetch";
import * as path from "path";
import * as vscode from "vscode";

import { Err, Ok, Result } from "ts-results";
import WorkspaceManager from "./api/workspaceManager";
import { ConnectionError } from "./errors";
/**
 * Downloads data from given url to the specified file path with a progress bar in the VSCode status bar.
 * @param url Url to data
 * @param title Title for status bar
 * @param message First message to be displayed in status bar
 * @param filePath Absolute path to the desired output file
 * @param headers Request headers if any
 */
export async function downloadFileWithProgress(url: string, filePath: string, title: string, message: string,
                                               headers?: any | undefined): Promise<Result<void, Error>> {

    let result: Result<void, Error> | undefined;
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `${title}` },
        async (p) => {
        p.report({
            message: `${message}` });
        result = await downloadFile(url, filePath, p, headers, () => { } );
        });
    if (result === undefined) {
        return new Err(new Error("Error while downloading files"));
    }
    return result;
}

/**
 * Downloads data from given url to the specified file. If file exists, its content will be overwritten.
 * @param url Url to data
 * @param filePath Absolute path to the desired output file
 * @param headers Request headers if any
 */
export async function downloadFile(url: string, filePath: string,
                                   progressHandle?: vscode.Progress<{ message?: string }>, headers?: any,
                                   progressCallback?: (downloaded: number, size: number) => void,
    ): Promise<Result<void, Error>> {

    fs.mkdirSync(path.resolve(filePath, ".."), { recursive: true });

    let response: fetch.Response;
    try {
        response = await fetch.default(url, { method: "get", headers });
        const sizeString = response.headers.get("content-length");
        if (sizeString && progressCallback) {
            let downloaded = 0;
            const size = parseInt(sizeString, 10);
            response.body.on("data", (chunk: Buffer) => {
                downloaded += chunk.length;
                const progress = Math.round((downloaded / size * 100));
                if (progressHandle !== undefined) {
                    progressHandle.report({
                        message: `Downloading important components for the Test My Code plugin... ${progress} %` });
                    }
                progressCallback(downloaded, size);
            });
        }
    } catch (error) {
        return new Err(new ConnectionError("Connection error: " + error.name));
    }

    if (!response.ok) {
        return new Err(new Error("Request failed: " + response.statusText));
    }

    try {
        await new Promise(async (resolve, reject) => {
            fs.writeFile(filePath, await response.buffer(), (err) => err ? reject(err) : resolve());
        });
    } catch (error) {
        return new Err(new Error("Writing to file failed: " + error));
    }

    return Ok.EMPTY;
}

/**
 * Await this to pause execution for an amount of time
 * @param millis
 */
export function sleep(millis: number) {
    return new Promise((resolve) => setTimeout(resolve, millis));
}

/**
 * Convert Chars to a string
 * @param array Char numbers array
 */
export function numbersToString(array: number[]) {
    return String.fromCharCode(...array);
}

/**
 * Get the Exercise ID for the currently open text editor
 */
export function getCurrentExerciseId(workspaceManager: WorkspaceManager): number | undefined {
    const editorPath = vscode.window.activeTextEditor?.document.fileName;
    if (!editorPath) {
        return undefined;
    }
    return workspaceManager.getExercisePath(editorPath);
}

/**
 * Creates a date object from string
 * @param deadline Deadline as string from API
 */
export function parseDeadline(deadline: string) {
    const inMillis = Date.parse(deadline);
    const date = new Date(inMillis);
    return date;
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
