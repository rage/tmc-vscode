import { expect } from "chai";
import * as vscode from "vscode";

import * as sessionState from "../fixtures/sessionState";
import { createMockMemento } from "../mocks/vscode";
import migrateSessionState from "../../storage/migration/sessionState";
import { v0, v1 } from "../../storage/data";

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
            });
        });

        test("succeeds with version 2.0.0 data", async function () {
            await memento.update(v1.SESSION_STATE_KEY, sessionState.v2_0_0);
            const migrated = migrateSessionState(memento).data;
            expect(migrated).to.be.deep.equal(sessionState.v2_0_0);
        });

        test("should succeed with backwards compatible future data", async function () {
            const data = { ...sessionState.v2_0_0, wonderwoman: "Diana Prince" };
            await memento.update(v1.SESSION_STATE_KEY, data);
            const migrated = migrateSessionState(memento).data;
            expect(migrated).to.be.deep.equal(data);
        });
    });

    suite("with unstable data", function () {
        test("fails with garbage data", async function () {
            await memento.update(v0.EXTENSION_VERSION_KEY, { wonderwoman: "Diana Prince" });
            expect(() => migrateSessionState(memento)).to.throw(/mismatch/);
        });

        test("finds extension version", async function () {
            await memento.update(v0.EXTENSION_VERSION_KEY, "1.3.4");
            const migrated = migrateSessionState(memento).data;
            expect(migrated?.extensionVersion).to.be.equal("1.3.4");
        });
    });

    suite("with stable data", function () {
        test("fails with garbage version 1 data", async function () {
            await memento.update(v1.SESSION_STATE_KEY, { extensionVersion: 1 });
            expect(() => migrateSessionState(memento)).to.throw(/mismatch/);
        });
    });
});
