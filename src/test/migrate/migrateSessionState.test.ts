import type * as vscode from "vscode"

import { v0, v1 } from "../../storage/data"
import migrateSessionState from "../../storage/migration/sessionState"
import * as sessionState from "../fixtures/sessionState"
import { createMockMemento } from "../mocks/vscode"

suite("Session state migration", function () {
  let memento: vscode.Memento

  beforeEach(function () {
    memento = createMockMemento()
  })

  suite("between versions", function () {
    test("has nothing to write without any data", function () {
      expect(migrateSessionState(memento).data).toBeUndefined()
    })

    test("leaves current data to stay as it is", async function () {
      await memento.update(v1.SESSION_STATE_KEY, sessionState.v2_0_0)
      expect(migrateSessionState(memento).data).toBeUndefined()
    })

    test("accepts backwards compatible future data", async function () {
      await memento.update(v1.SESSION_STATE_KEY, { ...sessionState.v2_0_0, wonderwoman: "Diana" })
      expect(migrateSessionState(memento).data).toBeUndefined()
    })
  })

  suite("with unstable data", function () {
    test("fails with garbage data", async function () {
      await memento.update(v0.EXTENSION_VERSION_KEY, { wonderwoman: "Diana Prince" })
      expect(() => migrateSessionState(memento)).toThrow(/mismatch/)
    })

    test("finds extension version", async function () {
      await memento.update(v0.EXTENSION_VERSION_KEY, "1.3.4")
      const migrated = migrateSessionState(memento).data
      expect(migrated?.extensionVersion).toBe("1.3.4")
    })
  })

  suite("with stable data", function () {
    test("fails with garbage version 1 data", async function () {
      await memento.update(v1.SESSION_STATE_KEY, { extensionVersion: 1 })
      expect(() => migrateSessionState(memento)).toThrow(/mismatch/)
    })
  })
})
