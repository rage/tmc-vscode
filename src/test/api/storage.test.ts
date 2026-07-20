import Storage from "../../storage"
import type { v3 } from "../../storage/data"
import { v3_0_0 as userData } from "../fixtures/userData"
import { createMockContext } from "../mocks/vscode"

suite("Storage class", function () {
  const extensionSettings: v3.ExtensionSettings = {
    downloadOldSubmission: true,
    hideMetaFiles: true,
    insiderVersion: false,
    logLevel: "verbose",
    updateExercisesAutomatically: true,
  }

  const sessionState: v3.SessionState = {
    extensionVersion: "2.0.0",
  }

  let storage: Storage

  beforeEach(function () {
    storage = new Storage(createMockContext())
  })

  test("should store and retrieve extension settings", async function () {
    expect(storage.getExtensionSettings()).toBeUndefined()
    await storage.updateExtensionSettings(extensionSettings)
    expect(storage.getExtensionSettings()).toEqual(extensionSettings)
  })

  test("should store and retrieve session state", async function () {
    expect(storage.getSessionState()).toBeUndefined()
    await storage.updateSessionState(sessionState)
    expect(storage.getSessionState()).toEqual(sessionState)
  })

  test("should store and retrieve user data", async function () {
    expect(storage.getUserData()).toBeUndefined()
    await storage.updateUserData(userData)
    expect(storage.getUserData()).toEqual(userData)
  })

  test("should use unique key for exercise data", async function () {
    expect(storage.getExtensionSettings()).toBeUndefined()
    expect(storage.getSessionState()).toBeUndefined()
    expect(storage.getUserData()).toBeUndefined()
  })

  test("should use unique key for extension settings", async function () {
    await storage.updateExtensionSettings(extensionSettings)
    expect(storage.getSessionState()).toBeUndefined()
    expect(storage.getUserData()).toBeUndefined()
  })

  test("should use unique key for session state", async function () {
    await storage.updateSessionState(sessionState)
    expect(storage.getExtensionSettings()).toBeUndefined()
    expect(storage.getUserData()).toBeUndefined()
  })

  test("should use unique key for user data", async function () {
    await storage.updateUserData(userData)
    expect(storage.getExtensionSettings()).toBeUndefined()
    expect(storage.getSessionState()).toBeUndefined()
  })

  test("should wipe all data", async function () {
    await storage.updateExtensionSettings(extensionSettings)
    await storage.updateSessionState(sessionState)
    await storage.updateUserData(userData)
    await storage.wipeStorage()
    expect(storage.getExtensionSettings()).toBeUndefined()
    expect(storage.getSessionState()).toBeUndefined()
    expect(storage.getUserData()).toBeUndefined()
  })
})
