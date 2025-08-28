import { createIs } from "typia";
import * as vscode from "vscode";

import * as data from "../data";
import validateData, { MigratedData } from ".";

namespace v0 {
    export function getVersion(memento: vscode.Memento): string | undefined {
        return validateData(memento.get<string>(data.v0.EXTENSION_VERSION_KEY), createIs<string>());
    }
}

namespace v1 {
    export function migrate(version: string | undefined): data.v1.SessionState {
        return {
            extensionVersion: version,
        };
    }
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
        const oldVersionData = v0.getVersion(memento);
        dataV1 = v1.migrate(oldVersionData);
    }

    return { data: dataV1, obsoleteKeys };
}
