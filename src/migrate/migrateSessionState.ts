import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { MigratedData } from "./types";
import validateData from "./validateData";

const SESSION_STATE_KEY_V1 = "session-state-v1";
const UNSTABLE_EXTENSION_VERSION_KEY = "extensionVersion";

export interface SessionStateV1 {
    extensionVersion?: string | undefined;
}

/**
 * Searches initial values from previous data keys.
 * @param memento Memento object used to search for keys
 */
function resolveInitialData(memento: vscode.Memento): SessionStateV1 {
    return {
        extensionVersion: memento.get<string>(UNSTABLE_EXTENSION_VERSION_KEY),
    };
}

export default function migrateSessionState(memento: vscode.Memento): MigratedData<SessionStateV1> {
    const obsoleteKeys: string[] = [];
    const dataV1 = validateData(
        memento.get<SessionStateV1>(SESSION_STATE_KEY_V1) ?? resolveInitialData(memento),
        createIs<SessionStateV1>(),
    );

    return { data: dataV1, obsoleteKeys };
}
