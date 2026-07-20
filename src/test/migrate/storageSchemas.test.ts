import { z } from "zod"

import { v0, v1, v2, v3 } from "../../storage/data"
import validateData from "../../storage/migration"
import * as exerciseData from "../fixtures/exerciseData"
import * as extensionSettings from "../fixtures/extensionSettings"
import * as sessionState from "../fixtures/sessionState"
import * as userData from "../fixtures/userData"

function expectAccepts(schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value)
  expect(result.success, result.success ? undefined : String(result.error)).toBe(true)
}

function expectRejects(schema: z.ZodType, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false)
}

suite("Versioned storage schemas", function () {
  const root = "/mock/root"

  suite("v0", function () {
    test("userDataSchema accepts all persisted v0 snapshots", function () {
      for (const fixture of [
        userData.v0_1_0,
        userData.v0_2_0,
        userData.v0_3_0,
        userData.v0_4_0,
        userData.v0_6_0,
        userData.v0_8_0,
        userData.v0_9_0,
        userData.v1_0_0,
      ]) {
        expectAccepts(v0.userDataSchema, fixture)
      }
    })

    test("userDataSchema accepts unknown extra keys", function () {
      expectAccepts(v0.userDataSchema, { ...userData.v0_1_0, batman: "Bruce Wayne" })
    })

    test("userDataSchema rejects garbage", function () {
      expectRejects(v0.userDataSchema, { batman: "Bruce Wayne" })
      expectRejects(v0.userDataSchema, { courses: [{ id: "not-a-number" }] })
    })

    test("localExerciseDataSchema accepts all persisted v0 snapshots", function () {
      for (const fixture of [
        exerciseData.v0_1_0(root),
        exerciseData.v0_2_0(root),
        exerciseData.v0_3_0,
        exerciseData.v0_9_0,
      ]) {
        expectAccepts(z.array(v0.localExerciseDataSchema), fixture)
      }
    })

    test("localExerciseDataSchema rejects garbage", function () {
      expectRejects(z.array(v0.localExerciseDataSchema), { ironman: "Tony Stark" })
      expectRejects(z.array(v0.localExerciseDataSchema), [{ id: 1 }])
    })

    test("extensionSettingsSchema accepts all persisted v0 snapshots", function () {
      for (const fixture of [
        extensionSettings.v0_3_0(root),
        extensionSettings.v0_5_0(root),
        extensionSettings.v0_9_0(root),
        extensionSettings.v1_0_0(root),
        extensionSettings.v1_2_0(root),
      ]) {
        expectAccepts(v0.extensionSettingsSchema, fixture)
      }
    })

    test("extensionSettingsSchema rejects data without dataPath", function () {
      expectRejects(v0.extensionSettingsSchema, { superman: "Clark Kent" })
    })
  })

  suite("v1", function () {
    test("userDataSchema accepts persisted v1 snapshot", function () {
      expectAccepts(v1.userDataSchema, userData.v2_0_0)
    })

    test("userDataSchema rejects v0 shaped data", function () {
      expectRejects(v1.userDataSchema, userData.v0_1_0)
    })

    test("extensionSettingsSchema accepts persisted v1 snapshot", function () {
      expectAccepts(v1.extensionSettingsSchema, extensionSettings.v2_0_0)
    })

    test("extensionSettingsSchema rejects invalid log level", function () {
      expectRejects(v1.extensionSettingsSchema, {
        ...extensionSettings.v2_0_0,
        logLevel: "debug",
      })
    })

    test("sessionStateSchema accepts persisted snapshot, empty object and extra keys", function () {
      expectAccepts(v1.sessionStateSchema, sessionState.v2_0_0)
      expectAccepts(v1.sessionStateSchema, {})
      expectAccepts(v1.sessionStateSchema, {
        ...sessionState.v2_0_0,
        wonderwoman: "Diana Prince",
      })
    })

    test("sessionStateSchema rejects wrong extensionVersion type", function () {
      expectRejects(v1.sessionStateSchema, { extensionVersion: 1 })
    })
  })

  suite("v2", function () {
    test("userDataSchema accepts persisted v2 snapshot", function () {
      expectAccepts(v2.userDataSchema, userData.v2_1_0)
    })

    test("userDataSchema rejects exercises without points", function () {
      expectRejects(v2.userDataSchema, userData.v2_0_0)
    })
  })

  suite("v3", function () {
    test("userDataSchema accepts persisted v3 snapshot", function () {
      expectAccepts(v3.userDataSchema, userData.v3_0_0)
    })

    test("userDataSchema rejects v2 data without mooc_courses", function () {
      expectRejects(v3.userDataSchema, userData.v2_1_0)
    })

    test("userDataSchema rejects mooc course with numeric id", function () {
      expectRejects(v3.userDataSchema, {
        ...userData.v3_0_0,
        mooc_courses: [{ id: 1 }],
      })
    })
  })

  suite("validateData", function () {
    test("returns undefined for missing data", function () {
      expect(validateData(undefined, v1.sessionStateSchema)).toBeUndefined()
      expect(validateData(null, v1.sessionStateSchema)).toBeUndefined()
    })

    test("returns the original object, preserving unknown extra keys", function () {
      const data = { ...userData.v2_1_0, batman: "Bruce Wayne" }
      const validated = validateData(data, v2.userDataSchema)
      expect(validated).toBe(data)
      expect(validated).toEqual(data)
    })

    test("throws a type mismatch error on invalid data", function () {
      expect(() => validateData({ batman: "Bruce Wayne" }, v2.userDataSchema)).toThrow(/mismatch/)
    })
  })
})
