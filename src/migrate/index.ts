import { Ok, Result } from "ts-results";
import * as vscode from "vscode";

import Storage from "../api/storage";

import { migrateUserData } from "./migrateUserData";

export async function migrateExtensionDataFromPreviousVersions(
    storage: Storage,
    context: vscode.ExtensionContext,
): Promise<Result<void, Error>> {
    const userData = storage.getUserData();
    if (!userData) {
        migrateUserData(context.globalState);
    }

    return Ok.EMPTY;
}
