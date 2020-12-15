import { expect } from "chai";
import * as vscode from "vscode";

import migrateSessionState, { SessionStateV1 } from "../../migrate/migrateSessionState";
import { createMockMemento } from "../__mocks__/vscode";

const EXTENSION_VERSION_KEY = "extensionVersion";
const UNSTABLE_EXTENSION_SETTINGS_KEY = "extensionSettings";
const SESSION_STATE_KEY_V1 = "session-state-v1";

suite("Session state migration", function () {
    let memento: vscode.Memento;

    setup(function () {
        memento = createMockMemento();
    });

    suite("between versions", function () {
        test("succeeds without any data", function () {
            const migrated = migrateSessionState(memento).data;
            expect(migrated).to.be.deep.equal({
                extensionVersion: undefined,
                oldDataPath: undefined,
            });
        });

        test("succeeds with version 2.0.0 data", async function () {
            const sessionState: SessionStateV1 = {
                extensionVersion: "2.0.0",
                oldDataPath: { path: "/path/to/exercises", timestamp: 1234 },
            };
            await memento.update(SESSION_STATE_KEY_V1, sessionState);
            const migrated = migrateSessionState(memento).data;
            expect(migrated).to.be.deep.equal(sessionState);
        });
    });

    suite("with unstable data", function () {
        test("fails with garbage data", async function () {
            await memento.update(EXTENSION_VERSION_KEY, { wonderwoman: "Diana Prince" });
            expect(() => migrateSessionState(memento)).to.throw(/missmatch/);

            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, {
                oldDataPath: { wonderwoman: "Diana Prince" },
            });
            expect(() => migrateSessionState(memento)).to.throw(/missmatch/);

            await memento.update(EXTENSION_VERSION_KEY, undefined);
            expect(() => migrateSessionState(memento)).to.throw(/missmatch/);
        });

        test("finds extension version", async function () {
            await memento.update(EXTENSION_VERSION_KEY, "1.3.4");
            const migrated = migrateSessionState(memento).data;
            expect(migrated?.extensionVersion).to.be.equal("1.3.4");
        });

        test("finds old data path", async function () {
            await memento.update(UNSTABLE_EXTENSION_SETTINGS_KEY, {
                oldDataPath: { path: "/path/to/exercises", timestamp: 1234 },
            });
            const migrated = migrateSessionState(memento).data;
            expect(migrated?.oldDataPath?.path).to.be.equal("/path/to/exercises");
            expect(migrated?.oldDataPath?.timestamp).to.be.equal(1234);
        });
    });

    suite("with stable data", function () {
        test("fails with garbage version 1 data", async function () {
            await memento.update(SESSION_STATE_KEY_V1, { wonderwoman: "Diana Prince" });
            expect(() => migrateSessionState(memento)).to.throw(/missmatch/);
        });
    });
});
