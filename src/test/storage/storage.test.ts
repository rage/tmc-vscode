import type * as vscode from "vscode"

import { CorruptStoredDataError } from "../../errors"
import Storage from "../../storage"
import { v3 } from "../../storage/data"
import { Logger, LogLevel } from "../../utilities"
import * as extensionSettings from "../fixtures/extensionSettings"
import * as sessionState from "../fixtures/sessionState"
import * as userData from "../fixtures/userData"
import { createMockContext } from "../mocks/vscode"

suite("Storage reads", function () {
  let context: vscode.ExtensionContext
  let storage: Storage

  beforeEach(function () {
    Logger.configure(LogLevel.Verbose)
    context = createMockContext()
    storage = new Storage(context)
  })

  test("reports nothing stored as nothing stored", function () {
    expect(storage.getUserData()).toBeUndefined()
    expect(storage.getExtensionSettings()).toBeUndefined()
    expect(storage.getSessionState()).toBeUndefined()
  })

  test("returns the stored value verbatim, unknown keys included", async function () {
    const stored = { ...userData.v3_0_0, batman: "Bruce Wayne" }
    await context.globalState.update(v3.USER_DATA_KEY, stored)
    expect(storage.getUserData()).toEqual(stored)
  })

  test("reads back what was written", async function () {
    await storage.updateUserData(userData.v3_0_0)
    await storage.updateExtensionSettings(extensionSettings.v2_0_0)
    await storage.updateSessionState(sessionState.v2_0_0)

    expect(storage.getUserData()).toEqual(userData.v3_0_0)
    expect(storage.getExtensionSettings()).toEqual(extensionSettings.v2_0_0)
    expect(storage.getSessionState()).toEqual(sessionState.v2_0_0)
  })

  test("does not report a course catalogue it cannot read as an empty one", async function () {
    const corrupt = { courses: "not a list of courses" }
    await context.globalState.update(v3.USER_DATA_KEY, corrupt)

    expect(() => storage.getUserData()).toThrow(CorruptStoredDataError)
    // The blob is the only copy of the catalogue, so it stays put.
    expect(context.globalState.get(v3.USER_DATA_KEY)).toEqual(corrupt)
  })

  test("rejects a user data blob that predates mooc courses", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, { courses: userData.v3_0_0.courses })
    expect(() => storage.getUserData()).toThrow(CorruptStoredDataError)
  })

  test("rejects unreadable settings and session state", async function () {
    await context.globalState.update(v3.EXTENSION_SETTINGS_KEY, { logLevel: "chatty" })
    await context.globalState.update(v3.SESSION_STATE_KEY, { extensionVersion: 3 })

    expect(() => storage.getExtensionSettings()).toThrow(CorruptStoredDataError)
    expect(() => storage.getSessionState()).toThrow(CorruptStoredDataError)
  })

  test("names the key it could not read", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, { courses: 1 })
    expect(() => storage.getUserData()).toThrow(v3.USER_DATA_KEY)
  })
})
