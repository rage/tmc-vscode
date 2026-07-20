import * as tmp from "tmp"
import type * as vscode from "vscode"

import type { v1 } from "../../storage/data"
import { v0 } from "../../storage/data"
import migrateExtensionSettings from "../../storage/migration/extensionSettings"
import { LogLevel } from "../../utilities"
import * as extensionSettings from "../fixtures/extensionSettings"
import { createMockMemento, createMockWorkspaceConfiguration } from "../mocks/vscode"

const EXTENSION_SETTINGS_KEY_V0 = "extensionSettings"
const EXTENSION_SETTINGS_KEY_V1 = "extension-settings-v1"
const UNSTABLE_EXTENSION_VERSION_KEY = "extensionVersion"
const SESSION_STATE_KEY_V1 = "session-state-v1"

suite("Extension settings migration", function () {
  let memento: vscode.Memento
  let settingsMock: vscode.WorkspaceConfiguration
  let root: string

  beforeEach(function () {
    memento = createMockMemento()
    settingsMock = createMockWorkspaceConfiguration()
    root = tmp.dirSync().name
  })

  suite("to vscode settings API", function () {
    test("should not happen when no data", async function () {
      await migrateExtensionSettings(memento, settingsMock)
      expect(settingsMock.update).not.toHaveBeenCalled()
    })

    test("should happen when no version is defined", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_5_0(root))
      await migrateExtensionSettings(memento, settingsMock)
      expect(settingsMock.update).toHaveBeenCalled()
    })

    test("should happen when old version is lower than 1.1.0", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_5_0(root))
      await memento.update(UNSTABLE_EXTENSION_VERSION_KEY, "0.1.0")
      await migrateExtensionSettings(memento, settingsMock)
      expect(settingsMock.update).toHaveBeenCalled()
    })

    test("should happen when old version is lower than 2.1.0", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0)
      await memento.update(SESSION_STATE_KEY_V1, { extensionVersion: "2.0.2" })
      await migrateExtensionSettings(memento, settingsMock)
      expect(settingsMock.update).toHaveBeenCalled()
    })

    test("should set correct values", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0)
      await memento.update(SESSION_STATE_KEY_V1, { extensionVersion: "2.0.2" })
      await migrateExtensionSettings(memento, settingsMock)
      expect(settingsMock.update).toHaveBeenCalledWith(
        "testMyCode.insiderVersion",
        extensionSettings.v2_0_0.insiderVersion,
        expect.anything(),
      )
      expect(settingsMock.update).toHaveBeenCalledWith(
        "testMyCode.downloadOldSubmission",
        extensionSettings.v2_0_0.downloadOldSubmission,
        expect.anything(),
      )
      expect(settingsMock.update).toHaveBeenCalledWith(
        "testMyCode.hideMetaFiles",
        extensionSettings.v2_0_0.hideMetaFiles,
        expect.anything(),
      )
      expect(settingsMock.update).toHaveBeenCalledWith(
        "testMyCode.logLevel",
        extensionSettings.v2_0_0.logLevel,
        expect.anything(),
      )
      expect(settingsMock.update).toHaveBeenCalledWith(
        "testMyCode.updateExercisesAutomatically",
        extensionSettings.v2_0_0.updateExercisesAutomatically,
        expect.anything(),
      )
    })

    test("should not happen when version matches or is above 2.1.0", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0)
      await memento.update(SESSION_STATE_KEY_V1, { extensionVersion: "2.2.2" })
      await migrateExtensionSettings(memento, settingsMock)
      expect(settingsMock.update).not.toHaveBeenCalled()
    })
  })

  suite("between versions", function () {
    test("should succeed without any data", async function () {
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated).toBeUndefined()
    })

    test("should succeed with version 0.5.0 data", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_5_0(root))
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated?.logLevel).toBe("verbose")
      expect(migrated?.hideMetaFiles).toBe(true)
    })

    test("should succeed with version 0.9.0 data", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v0_9_0(root))
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated?.insiderVersion).toBe(true)
    })

    test("should succeed with version 1.0.0 data", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v1_0_0(root))
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated?.downloadOldSubmission).toBe(false)
    })

    test("should succeed with version 1.2.0 data", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, extensionSettings.v1_2_0(root))
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated?.updateExercisesAutomatically).toBe(false)
    })

    test("should succeed with version 2.0.0 data", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V1, extensionSettings.v2_0_0)
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated).toEqual(extensionSettings.v2_0_0)
    })

    test("should succeed with backwards compatible future data", async function () {
      const data = { ...extensionSettings.v2_0_0, superman: "Clark Kent" }
      await memento.update(EXTENSION_SETTINGS_KEY_V1, data)
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated).toEqual(data)
    })
  })

  suite("with unstable data", function () {
    test("should fail if data is garbage", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, { superman: "Clark Kent" })
      await expect(migrateExtensionSettings(memento, settingsMock)).rejects.toThrow(/mismatch/)
    })

    test("should set valid placeholders with minimal data", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V0, { dataPath: root })
      const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
      expect(migrated?.downloadOldSubmission).toBe(true)
      expect(migrated?.hideMetaFiles).toBe(true)
      expect(migrated?.insiderVersion).toBe(false)
      expect(migrated?.logLevel).toBe(LogLevel.Errors)
      expect(migrated?.updateExercisesAutomatically).toBe(true)
    })

    test("should remap logger values properly", async function () {
      const expectedRemappings: [v0.LogLevel, v1.LogLevel][] = [
        [v0.LogLevel.Debug, "verbose"],
        [v0.LogLevel.Errors, "errors"],
        [v0.LogLevel.None, "none"],
        [v0.LogLevel.Verbose, "verbose"],
      ]
      for (const [oldLevel, expectedLevel] of expectedRemappings) {
        const oldSettings: v0.ExtensionSettings = { dataPath: root, logLevel: oldLevel }
        await memento.update(EXTENSION_SETTINGS_KEY_V0, oldSettings)
        const migrated = (await migrateExtensionSettings(memento, settingsMock)).data
        expect(migrated?.logLevel).toBe(expectedLevel)
      }
    })
  })

  suite("with stable data", function () {
    test("should fail with garbage version 1 data", async function () {
      await memento.update(EXTENSION_SETTINGS_KEY_V1, { superman: "Clark Kent" })
      await expect(migrateExtensionSettings(memento, settingsMock)).rejects.toThrow(/mismatch/)
    })
  })
})
