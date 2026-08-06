import { Ok } from "ts-results"
import type * as vscode from "vscode"

import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import Storage from "../../storage"
import { v0, v1 } from "../../storage/data"
import { Logger, LogLevel } from "../../utilities"
import * as exerciseData from "../fixtures/exerciseData"
import * as extensionSettings from "../fixtures/extensionSettings"
import * as sessionState from "../fixtures/sessionState"
import * as userData from "../fixtures/userData"
import { createDialogMock } from "../mocks/dialog"
import { createFailingTMCMock, createTMCMock } from "../mocks/tmc"
import { createMockContext, createMockWorkspaceConfiguration } from "../mocks/vscode"
import { makeTmpDirs } from "../utils"

suite("Extension data migration", function () {
  const virtualFileSystem = {
    "/TMC workspace/": {
      Exercises: { test: { "test-python-course": { hello_world: {} } } },
      "closed-exercises": { "2": {} },
    },
  }

  let context: vscode.ExtensionContext
  let dialogMock: Dialog
  let storage: Storage
  let tmcMock: Langs
  let settingsMock: vscode.WorkspaceConfiguration
  let root: string

  beforeEach(function () {
    Logger.configure(LogLevel.Verbose)
    root = makeTmpDirs(virtualFileSystem)
    context = createMockContext()
    ;[dialogMock] = createDialogMock()
    settingsMock = createMockWorkspaceConfiguration()
    storage = new Storage(context)
    ;[tmcMock] = createTMCMock()
  })

  test("should succeed without any data", async function () {
    const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
    expect(result.ok).toBe(true)
  })

  test.todo("should be compatible with extended future data")

  suite("from version 0.1.0", function () {
    test("should succeed with valid data", async function () {
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_1_0(root))
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_1_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result).toBe(Ok.EMPTY)
      expect(storage.getUserData()).not.toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toBeUndefined()
    })

    test("should not change anything if Langs fails", async function () {
      ;[tmcMock] = createFailingTMCMock()
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_1_0(root))
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_1_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.val).toBeInstanceOf(Error)
      expect(storage.getUserData()).toBeUndefined()
      console.log("a", context.globalState.get(v0.EXERCISE_DATA_KEY))
      console.log("b", exerciseData.v0_1_0(root))
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toEqual(exerciseData.v0_1_0(root))
      expect(context.globalState.get(v0.USER_DATA_KEY)).toEqual(userData.v0_1_0)
    })
  })

  suite("from version 0.2.0", function () {
    test("should succeed with valid data", async function () {
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_2_0(root))
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_2_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result).toBe(Ok.EMPTY)
      expect(storage.getUserData()).not.toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toBeUndefined()
    })

    test("should not modify data if Langs fails", async function () {
      ;[tmcMock] = createFailingTMCMock()
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_2_0(root))
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_2_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.val).toBeInstanceOf(Error)
      expect(storage.getUserData()).toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toEqual(exerciseData.v0_2_0(root))
      expect(context.globalState.get(v0.USER_DATA_KEY)).toEqual(userData.v0_2_0)
    })
  })

  suite("from version 0.3.0", function () {
    test("should succeed with valid data", async function () {
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_3_0)
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_3_0)
      await context.globalState.update(v0.EXTENSION_SETTINGS_KEY, extensionSettings.v0_3_0(root))
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result).toBe(Ok.EMPTY)
      expect(storage.getUserData()).not.toBeUndefined()
      expect(storage.getExtensionSettings()).not.toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toBeUndefined()
      expect(context.globalState.get(v0.EXTENSION_SETTINGS_KEY)).toBeUndefined()
      expect(context.globalState.get(v0.USER_DATA_KEY)).toBeUndefined()
    })

    test("should not modify data if Langs fails", async function () {
      ;[tmcMock] = createFailingTMCMock()
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_3_0)
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_3_0)
      await context.globalState.update(v0.EXTENSION_SETTINGS_KEY, extensionSettings.v0_3_0(root))
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.val).toBeInstanceOf(Error)
      expect(storage.getUserData()).toBeUndefined()
      expect(storage.getExtensionSettings()).toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toEqual(exerciseData.v0_3_0)
      expect(context.globalState.get(v0.EXTENSION_SETTINGS_KEY)).toEqual(
        extensionSettings.v0_3_0(root),
      )
      expect(context.globalState.get(v0.USER_DATA_KEY)).toEqual(userData.v0_3_0)
    })
  })

  suite("from version 0.9.0", function () {
    test("should succeed with valid data", async function () {
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_9_0)
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_9_0)
      await context.globalState.update(v0.EXTENSION_SETTINGS_KEY, extensionSettings.v0_9_0(root))
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result).toBe(Ok.EMPTY)
      expect(storage.getUserData()).not.toBeUndefined()
      expect(storage.getExtensionSettings()).not.toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toBeUndefined()
      expect(context.globalState.get(v0.EXTENSION_SETTINGS_KEY)).toBeUndefined()
      expect(context.globalState.get(v0.USER_DATA_KEY)).toBeUndefined()
    })

    test("should not modify data if Langs fails", async function () {
      ;[tmcMock] = createFailingTMCMock()
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_9_0)
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_9_0)
      await context.globalState.update(v0.EXTENSION_SETTINGS_KEY, extensionSettings.v0_9_0(root))
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.val).toBeInstanceOf(Error)
      expect(storage.getUserData()).toBeUndefined()
      expect(storage.getExtensionSettings()).toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toEqual(exerciseData.v0_9_0)
      expect(context.globalState.get(v0.EXTENSION_SETTINGS_KEY)).toEqual(
        extensionSettings.v0_9_0(root),
      )
      expect(context.globalState.get(v0.USER_DATA_KEY)).toEqual(userData.v0_9_0)
    })
  })

  suite("from version 2.0.0", function () {
    test("should succeed with valid data", async function () {
      await context.globalState.update(v1.USER_DATA_KEY, userData.v2_0_0)
      await context.globalState.update(v1.EXTENSION_SETTINGS_KEY, extensionSettings.v2_0_0)
      await context.globalState.update(v1.SESSION_STATE_KEY, sessionState.v2_0_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result).toBe(Ok.EMPTY)
      expect(storage.getUserData()).not.toBeUndefined()
      expect(storage.getExtensionSettings()).not.toBeUndefined()
      expect(storage.getSessionState()).not.toBeUndefined()
    })
  })
})
