import * as fs from "fs";
import * as fetch from "node-fetch";
import * as path from "path";
import * as vscode from "vscode";

import { Err, Ok, Result } from "ts-results";
import { ConnectionError } from "./errors";

/**
 * Downloads data from given url to specified file. Path to file must exist but file itself not.
 * @param url Url to data
 * @param filePath Absolute path to the desired output file
 * @param headers Request headers if any
 */
export async function downloadFile(url: string, filePath: string, headers?: any): Promise<Result<void, Error>> {
    if (!fs.existsSync(path.resolve(filePath, "..")) || fs.existsSync(filePath)) {
        throw new Error("Invalid file path or file already exists");
    }

    let response;
    try {
        response = await fetch.default(url, { method: "get", headers });
    } catch (error) {
        return new Err(new ConnectionError("Connection error: " + error.name));
    }

    if (response.ok) {
        try {
            fs.writeFileSync(filePath, await response.buffer());
        } catch (error) {
            return new Err(new Error("Writing to file failed: " + error));
        }
        return Ok.EMPTY;
    } else {
        return new Err(new Error("Request failed: " + response.statusText));
    }
}

export async function openFolder(folderPath: string) {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folderPath));;
}