import validateData, { MigratedData } from ".";
import * as data from "../data";
import { createIs } from "typia";
import * as vscode from "vscode";

export function v0_getVersion(memento: vscode.Memento): string | undefined {
    return validateData(memento.get<string>(data.v0.EXTENSION_VERSION_KEY), createIs<string>());
}

export function v1_migrateFromV0(version: string | undefined): data.v1.SessionState {
    return {
        extensionVersion: version,
    };
}

export default function migrateSessionState(
    memento: vscode.Memento,
): MigratedData<data.v1.SessionState> {
    const obsoleteKeys: string[] = [];

    let dataV1 = validateData(
        memento.get<data.v1.SessionState>(data.v1.SESSION_STATE_KEY),
        createIs<data.v1.SessionState>(),
    );
    if (!dataV1) {
        const oldVersionData = v0_getVersion(memento);
        dataV1 = v1_migrateFromV0(oldVersionData);
    }

    return { data: dataV1, obsoleteKeys };
}
