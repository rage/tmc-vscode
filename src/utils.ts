import * as cp from "child_process";
import * as fs from "fs";
import * as fetch from "node-fetch";
import * as path from "path";
import * as vscode from "vscode";

import { Err, Ok, Result } from "ts-results";
import { is } from "typescript-is";
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
 * Check if calling java programs is possible.
 */
export async function isJavaPresent(): Promise<boolean> {
    let result = false;
    await new Promise((resolve) => cp.exec("java -version", (error) => {
        result = (error === null);
        resolve();
    }));

    return result;
}

/**
 * Checks whether the extension is running in a development or production environment.
 */
export function isProductionBuild(): boolean {
    // Use configuration properties to see whether superflous object properties are enabled in tsconfig.
    // In the code this feature is used when fetched API data is being parsed.
    // For configuration, see tsconfig.json used by webpack.dev.json
    // and tsconfig.production.json used by webpack.prod.json
    type TestType = {
        strict: boolean,
    };

    const testObject = {
        strict: true,
        superflous: "a superfluous property",
    };

    return is<TestType>(testObject);
}

/**
 * Await this to pause execution for an amount of time
 * @param millis
 */
export function sleep(millis: number) {
    return new Promise((resolve) => setTimeout(resolve, millis));
}

export function numbersToString(array: number[]) {
    return String.fromCharCode(...array);
}

export function getCurrentExerciseId(workspaceManager: WorkspaceManager): number | undefined {
    const editorPath = vscode.window.activeTextEditor?.document.fileName;
    if (!editorPath) {
        return undefined;
    }
    return workspaceManager.getExercisePath(editorPath);
}
