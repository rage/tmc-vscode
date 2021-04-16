import { expect } from "chai";

import Storage, { ExtensionSettings, SessionState } from "../../api/storage";
import { v2_1_0 as userData } from "../fixtures/userData";
import { createMockContext } from "../mocks/vscode";

suite("Storage class", function () {
    const extensionSettings: ExtensionSettings = {
        downloadOldSubmission: true,
        hideMetaFiles: true,
        insiderVersion: false,
        logLevel: "verbose",
        updateExercisesAutomatically: true,
    };

    const sessionState: SessionState = {
        extensionVersion: "2.0.0",
    };

    let storage: Storage;

    setup(function () {
        storage = new Storage(createMockContext());
    });

    test("should store and retrieve extension settings", async function () {
        expect(storage.getExtensionSettings()).to.be.undefined;
        await storage.updateExtensionSettings(extensionSettings);
        expect(storage.getExtensionSettings()).to.be.deep.equal(extensionSettings);
    });

    test("should store and retrieve session state", async function () {
        expect(storage.getSessionState()).to.be.undefined;
        await storage.updateSessionState(sessionState);
        expect(storage.getSessionState()).to.be.deep.equal(sessionState);
    });

    test("should store and retrieve user data", async function () {
        expect(storage.getUserData()).to.be.undefined;
        await storage.updateUserData(userData);
        expect(storage.getUserData()).to.be.deep.equal(userData);
    });

    test("should use unique key for exercise data", async function () {
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getSessionState()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });

    test("should use unique key for extension settings", async function () {
        await storage.updateExtensionSettings(extensionSettings);
        expect(storage.getSessionState()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });

    test("should use unique key for session state", async function () {
        await storage.updateSessionState(sessionState);
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });

    test("should use unique key for user data", async function () {
        await storage.updateUserData(userData);
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getSessionState()).to.be.undefined;
    });

    test("should wipe all data", async function () {
        await storage.updateExtensionSettings(extensionSettings);
        await storage.updateSessionState(sessionState);
        await storage.updateUserData(userData);
        await storage.wipeStorage();
        expect(storage.getExtensionSettings()).to.be.undefined;
        expect(storage.getSessionState()).to.be.undefined;
        expect(storage.getUserData()).to.be.undefined;
    });
});
