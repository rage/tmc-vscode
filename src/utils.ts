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
export async function downloadFile(url: string, filePath: string, headers?: any): Promise<Result<void, Error>> {
    fs.mkdirSync(path.resolve(filePath, ".."), { recursive: true });

    let response;
    try {
        response = await fetch.default(url, { method: "get", headers });
    } catch (error) {
        return new Err(new ConnectionError("Connection error: " + error.name));
    }

    if (!response.ok) { return new Err(new Error("Request failed: " + response.statusText)); }

    try {
        fs.writeFileSync(filePath, await response.buffer());
    } catch (error) {
        return new Err(new Error("Writing to file failed: " + error));
    }

    return Ok.EMPTY;
}

/**
 * Opens the given folder in Visual Studio Code's explorer.
 * @param folderPath Absolute path to the folder
 */
export async function openFolder(folderPath: string): Promise<void> {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folderPath));
}
