import * as path from "path"

import * as fs from "fs-extra"
import * as vscode from "vscode"

import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import Storage from "../../storage"
import type { MoocLocalCourseData } from "../../storage/data"
import { v0, v1, v3 } from "../../storage/data"
import { obsoleteKeys } from "../../storage/migration"
import { Logger, LogLevel } from "../../utilities"
import * as exerciseData from "../fixtures/exerciseData"
import * as extensionSettings from "../fixtures/extensionSettings"
import * as sessionState from "../fixtures/sessionState"
import * as userData from "../fixtures/userData"
import { createDialogMock } from "../mocks/dialog"
import { createFailingTMCMock, createTMCMock } from "../mocks/tmc"
import { createMockContext, createMockWorkspaceConfiguration } from "../mocks/vscode"
import { makeTmpDirs } from "../utils"

/** Spelled out rather than imported: no storage version declares it any more. */
const RETIRED_EXTENSION_SETTINGS_KEY = "extension-settings-v3"

/** Puts the window in `<dataPath>/TMC workspace/<name>`, which is where v0 kept it. */
function openLegacyWorkspace(dataPath: string, name: string): void {
  Object.defineProperty(vscode.workspace, "workspaceFile", {
    value: vscode.Uri.file(path.join(dataPath, "TMC workspace", name)),
    configurable: true,
  })
}

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
    expect(result.kind).toBe("done")
  })

  test.todo("should be compatible with extended future data")

  suite("from version 0.1.0", function () {
    test("should succeed with valid data", async function () {
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_1_0(root))
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_1_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.kind).toBe("done")
      expect(storage.getUserData()).not.toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toBeUndefined()
    })

    test("should not change anything if Langs fails", async function () {
      ;[tmcMock] = createFailingTMCMock()
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_1_0(root))
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_1_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.kind).toBe("failed")
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
      expect(result.kind).toBe("done")
      expect(storage.getUserData()).not.toBeUndefined()
      expect(context.globalState.get(v0.EXERCISE_DATA_KEY)).toBeUndefined()
    })

    test("should not modify data if Langs fails", async function () {
      ;[tmcMock] = createFailingTMCMock()
      await context.globalState.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_2_0(root))
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_2_0)
      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.kind).toBe("failed")
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
      expect(result.kind).toBe("done")
      expect(storage.getUserData()).not.toBeUndefined()
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
      expect(result.kind).toBe("failed")
      expect(storage.getUserData()).toBeUndefined()
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
      expect(result.kind).toBe("done")
      expect(storage.getUserData()).not.toBeUndefined()
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
      expect(result.kind).toBe("failed")
      expect(storage.getUserData()).toBeUndefined()
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
      expect(result.kind).toBe("done")
      expect(storage.getUserData()).not.toBeUndefined()
      expect(storage.getSessionState()).not.toBeUndefined()
    })
  })

  suite("source key retirement", function () {
    // Every key any migration touches, so the survivor assertion is exact
    // rather than a spot check.
    const migrationKeys = [
      v0.EXERCISE_DATA_KEY,
      v0.EXTENSION_SETTINGS_KEY,
      v0.EXTENSION_VERSION_KEY,
      v0.USER_DATA_KEY,
      v1.EXTENSION_SETTINGS_KEY,
      v1.USER_DATA_KEY,
      v3.SESSION_STATE_KEY,
      RETIRED_EXTENSION_SETTINGS_KEY,
      v3.USER_DATA_KEY,
    ]
    const currentKeys = [v3.SESSION_STATE_KEY, v3.USER_DATA_KEY]

    function survivingKeys(): string[] {
      return migrationKeys.filter((key) => context.globalState.get(key) !== undefined)
    }

    test("entering from version 0 leaves only the current keys", async function () {
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_9_0)
      await context.globalState.update(v0.EXTENSION_SETTINGS_KEY, extensionSettings.v0_9_0(root))
      await context.globalState.update(v0.EXTENSION_VERSION_KEY, "1.3.4")

      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.kind).toBe("done")
      expect(survivingKeys()).toEqual(currentKeys)
    })

    test("entering from version 2 leaves only the current keys", async function () {
      await context.globalState.update(v1.USER_DATA_KEY, userData.v2_1_0)
      await context.globalState.update(v1.EXTENSION_SETTINGS_KEY, extensionSettings.v2_0_0)
      await context.globalState.update(v1.SESSION_STATE_KEY, sessionState.v2_0_0)

      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.kind).toBe("done")
      expect(survivingKeys()).toEqual(currentKeys)
    })

    test("entering from version 3 keeps the stored data untouched", async function () {
      await context.globalState.update(v3.USER_DATA_KEY, userData.v3_0_0)
      await context.globalState.update(v3.SESSION_STATE_KEY, sessionState.v2_0_0)

      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)
      expect(result.kind).toBe("done")
      expect(survivingKeys()).toEqual([v3.SESSION_STATE_KEY, v3.USER_DATA_KEY])
      expect(storage.getUserData()).toEqual(userData.v3_0_0)
    })

    test("drops the settings copy it no longer keeps, and nothing beside it", async function () {
      await context.globalState.update(RETIRED_EXTENSION_SETTINGS_KEY, extensionSettings.v2_0_0)
      await context.globalState.update(v3.USER_DATA_KEY, userData.v3_0_0)
      await context.globalState.update(v3.SESSION_STATE_KEY, sessionState.v2_0_0)

      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)

      expect(result.kind).toBe("done")
      expect(context.globalState.get(RETIRED_EXTENSION_SETTINGS_KEY)).toBeUndefined()
      expect(storage.getUserData()).toEqual(userData.v3_0_0)
      expect(storage.getSessionState()).toEqual(sessionState.v2_0_0)
    })

    test("a second run does not replay the first run's source data", async function () {
      await context.globalState.update(v1.USER_DATA_KEY, userData.v2_1_0)
      expect((await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)).kind).toBe(
        "done",
      )

      // Everything the user does between two activations: enrol on a mooc
      // course, which the v1 snapshot has no field for, and drop a tmc one.
      const moocCourse: MoocLocalCourseData = {
        id: "8bd5a0d6-8ba0-4b2a-a2e0-0dd1ba7f2af5",
        name: "mooc-course",
        title: "A courses.mooc.fi course",
        description: null,
        organization: "mooc",
        exercises: [],
        availablePoints: 0,
        awardedPoints: 0,
        perhapsExamMode: false,
        newExercises: [],
        notifyAfter: 0,
        disabled: false,
        materialUrl: null,
      }
      await storage.updateUserData({ courses: [], mooc_courses: [moocCourse] })

      expect((await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)).kind).toBe(
        "done",
      )
      expect(storage.getUserData()).toEqual({ courses: [], mooc_courses: [moocCourse] })
    })
  })

  suite("a workspace still in the pre-2.0 data folder", function () {
    afterEach(function () {
      Object.defineProperty(vscode.workspace, "workspaceFile", {
        value: undefined,
        configurable: true,
      })
    })

    test("asks for a reload instead of migrating in place", async function () {
      await context.globalState.update(v0.EXTENSION_SETTINGS_KEY, { dataPath: root })
      await context.globalState.update(v0.USER_DATA_KEY, userData.v0_9_0)
      openLegacyWorkspace(root, "python-course.code-workspace")

      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)

      expect(result).toEqual({
        kind: "needsReload",
        workspaceName: "python-course.code-workspace",
      })
      expect(storage.getUserData()).toBeUndefined()
      expect(context.globalState.get(v0.USER_DATA_KEY)).toEqual(userData.v0_9_0)
    })

    // Writing the files and reopening the window belong to the caller, so the
    // migration itself must leave the workspace alone.
    test("creates no workspace files of its own", async function () {
      await context.globalState.update(v0.EXTENSION_SETTINGS_KEY, { dataPath: root })
      openLegacyWorkspace(root, "python-course.code-workspace")

      const result = await storage.migrateToLatest(context, dialogMock, tmcMock, settingsMock)

      expect(result.kind).toBe("needsReload")
      expect(fs.existsSync(path.join(context.globalStoragePath, "workspaces"))).toBe(false)
    })
  })

  suite("obsoleteKeys", function () {
    test("never retires a key another migration writes to", function () {
      const retired = obsoleteKeys([
        { data: undefined, supersededKeys: ["shared", "superseded"], destinationKey: undefined },
        { data: undefined, supersededKeys: [], destinationKey: "shared" },
      ])
      expect(retired).toEqual(["superseded"])
    })
  })
})
