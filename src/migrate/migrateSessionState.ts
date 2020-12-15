import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { MigratedData } from "./types";
import validateData from "./validateData";

const EXTENSION_VERSION_KEY = "extensionVersion";
const SESSION_STATE_KEY_V1 = "session-state-v1";
const UNSTABLE_EXTENSION_SETTINGS_KEY = "extensionSettings";

export interface SessionStateV1 {
    extensionVersion?: string | undefined;
    oldDataPath?: { path: string; timestamp: number } | undefined;
}

/**
 * Searches initial values from previous data keys.
 * @param memento Memento object used to search for keys
 */
function resolveInitialData(memento: vscode.Memento): SessionStateV1 {
    interface ExtensionSettingsPartial {
        oldDataPath?: { path: string; timestamp: number };
    }

    return {
        extensionVersion: memento.get<string>(EXTENSION_VERSION_KEY),
        oldDataPath: memento.get<ExtensionSettingsPartial>(UNSTABLE_EXTENSION_SETTINGS_KEY)
            ?.oldDataPath,
    };
}

export function migrateSessionState(memento: vscode.Memento): MigratedData<SessionStateV1> {
    const keys: string[] = [SESSION_STATE_KEY_V1];
    const dataV1 = validateData(
        memento.get<SessionStateV1>(SESSION_STATE_KEY_V1) ?? resolveInitialData(memento),
        createIs<SessionStateV1>(),
    );

    return { data: dataV1, keys };
}
