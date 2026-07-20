import type * as vscode from "vscode"

import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import { v0 } from "../../storage/data"
import migrateExerciseDataToLatest from "../../storage/migration/exerciseData"
import { Logger, LogLevel } from "../../utilities"
import * as exerciseData from "../fixtures/exerciseData"
import { createDialogMock } from "../mocks/dialog"
import { createTMCMock } from "../mocks/tmc"
import { createMockMemento } from "../mocks/vscode"
import { makeTmpDirs } from "../utils"

suite("Exercise data migration", function () {
  const virtualFileSystem = {
    "/TMC workspace/": {
      Exercises: { test: { "test-python-course": { hello_world: {} } } },
      "closed-exercises": { "2": {} },
    },
  }

  let dialogMock: Dialog
  let memento: vscode.Memento
  let tmcMock: Langs

  beforeEach(function () {
    ;[dialogMock] = createDialogMock()
    memento = createMockMemento()
    ;[tmcMock] = createTMCMock()
    Logger.configure(LogLevel.Verbose)
  })

  suite("between versions", function () {
    test("should succeed without any data", async function () {
      const migrated = await migrateExerciseDataToLatest(memento, dialogMock, tmcMock)
      expect(migrated.data).toBeUndefined()
      expect(migrated.obsoleteKeys).toEqual([])
    })

    test("should succeed with version 0.1.0 data", async function () {
      const dataPath = makeTmpDirs(virtualFileSystem)
      await memento.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_1_0(dataPath))
      const migrated = await migrateExerciseDataToLatest(memento, dialogMock, tmcMock)
      expect(migrated.data).toBeUndefined()
      expect(migrated.obsoleteKeys).toEqual([v0.EXERCISE_DATA_KEY])
    })

    test("should succeed with version 0.2.0 data", async function () {
      const dataPath = makeTmpDirs(virtualFileSystem)
      await memento.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_2_0(dataPath))
      const migrated = await migrateExerciseDataToLatest(memento, dialogMock, tmcMock)
      expect(migrated.data).toBeUndefined()
      expect(migrated.obsoleteKeys).toEqual([v0.EXERCISE_DATA_KEY])
    })

    test("should succeed with version 0.3.0 data", async function () {
      const dataPath = makeTmpDirs(virtualFileSystem)
      await memento.update(v0.EXTENSION_SETTINGS_KEY, { dataPath })
      await memento.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_3_0)
      const migrated = await migrateExerciseDataToLatest(memento, dialogMock, tmcMock)
      expect(migrated.data).toBeUndefined()
      expect(migrated.obsoleteKeys).toEqual([v0.EXERCISE_DATA_KEY])
    })

    test("should succeed with version 0.9.0 data", async function () {
      const dataPath = makeTmpDirs(virtualFileSystem)
      await memento.update(v0.EXTENSION_SETTINGS_KEY, { dataPath })
      await memento.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_9_0)
      const migrated = await migrateExerciseDataToLatest(memento, dialogMock, tmcMock)
      expect(migrated.data).toBeUndefined()
      expect(migrated.obsoleteKeys).toEqual([v0.EXERCISE_DATA_KEY])
    })
  })

  suite("with unstable data", function () {
    test("should fail if data is garbage", async function () {
      await memento.update(v0.EXERCISE_DATA_KEY, { ironman: "Tony Stark" })
      await expect(migrateExerciseDataToLatest(memento, dialogMock, tmcMock)).rejects.toThrow(
        /mismatch/,
      )
    })

    test("should set closed exercises to TMC-langs", async function () {
      const dataPath = makeTmpDirs(virtualFileSystem)
      await memento.update(v0.EXTENSION_SETTINGS_KEY, { dataPath })
      await memento.update(v0.EXERCISE_DATA_KEY, exerciseData.v0_3_0)
      await migrateExerciseDataToLatest(memento, dialogMock, tmcMock)
      const testValue = ["other_world"]
      expect(tmcMock.setSetting).toHaveBeenCalledWith(
        "closed-exercises-for:test-python-course",
        testValue,
      )
    })
  })
})
