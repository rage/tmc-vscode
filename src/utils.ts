import * as fs from "fs";
import * as fetch from "node-fetch";
import * as path from "path";
import * as vscode from "vscode";

import { Err, Ok, Result } from "ts-results";
import { ConnectionError } from "./errors";

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
