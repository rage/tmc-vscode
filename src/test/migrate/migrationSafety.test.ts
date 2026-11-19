import { vi } from "vitest"
import type * as vscode from "vscode"

import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import { EXTENSION_VERSION } from "../../config/constants"
import { StoredDataMigrationError } from "../../errors"
import Storage from "../../storage"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../../storage/data"
import { v0, v1, v2, v3 } from "../../storage/data"
import { Logger, LogLevel } from "../../utilities"
import * as extensionSettings from "../fixtures/extensionSettings"
import * as userData from "../fixtures/userData"
import { createDialogMock } from "../mocks/dialog"
import { createTMCMock } from "../mocks/tmc"
import { createMockContext, createMockWorkspaceConfiguration } from "../mocks/vscode"

const moocCourse: MoocLocalCourseData = {
  id: "8bd5a0d6-8ba0-4b2a-a2e0-0dd1ba7f2af5",
  name: "mooc-course",
  title: "A courses.mooc.fi course",
  description: null,
  organization: "mooc",
  aiPolicy: "not_set",
  exercises: [],
  availablePoints: 0,
  awardedPoints: 0,
  newExercises: [],
  notifyAfter: 0,
}

function tmcCourse(id: number, name: string): TmcLocalCourseData {
  return {
    id,
    name,
    title: name,
    description: "",
    organization: "mooc",
    exercises: [
      {
        id: id * 10,
        availablePoints: 1,
        awardedPoints: 0,
        name: `${name}-e1`,
        deadline: null,
        passed: false,
        softDeadline: null,
      },
    ],
    availablePoints: 1,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  }
}

/** What 3.5.5 keeps under `user-data-v1`: plain v2 courses, rewritten whole on every change. */
type V355UserData = v2.UserData

suite("Storage migration safety", function () {
  let context: vscode.ExtensionContext
  let memento: vscode.Memento
  let dialog: Dialog
  let langs: Langs
  let settings: vscode.WorkspaceConfiguration
  let storage: Storage

  beforeEach(function () {
    Logger.configure(LogLevel.Verbose)
    context = createMockContext()
    memento = context.globalState
    ;[dialog] = createDialogMock()
    ;[langs] = createTMCMock()
    settings = createMockWorkspaceConfiguration()
    storage = new Storage(context)
  })

  afterEach(function () {
    vi.restoreAllMocks()
  })

  function migrate(withLangs = true): ReturnType<Storage["migrateToLatest"]> {
    return storage.migrateToLatest(context, dialog, withLangs ? langs : undefined, settings)
  }

  function migrationLog(): v3.MigrationRun[] {
    return memento.get<v3.MigrationDiagnostics>(v3.MIGRATION_DIAGNOSTICS_KEY)?.runs ?? []
  }

  function keptUnreadable(): unknown[] {
    return (
      memento.get<v3.MigrationDiagnostics>(v3.MIGRATION_DIAGNOSTICS_KEY)?.unreadable ?? []
    ).map(({ value }) => value)
  }

  suite("upgrading", function () {
    test("from v0 keeps a 3.x-readable copy and retires the v0 key", async function () {
      await memento.update(v0.USER_DATA_KEY, userData.v1_0_0)

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()).toEqual(userData.v3_0_0)
      expect(memento.get(v1.USER_DATA_KEY)).toEqual(userData.v2_1_0)
      expect(memento.get(v0.USER_DATA_KEY)).toBeUndefined()
    })

    test("from the 2.0 shape fills in the exercise points it lacks", async function () {
      await memento.update(v1.USER_DATA_KEY, userData.v2_0_0)

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()).toEqual(userData.v3_0_0)
      expect(memento.get(v1.USER_DATA_KEY)).toEqual(userData.v2_1_0)
    })

    test("from the 3.x shape leaves user-data-v1 as 3.5.5 wrote it", async function () {
      await memento.update(v1.USER_DATA_KEY, userData.v2_1_0)

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()).toEqual(userData.v3_0_0)
      expect(memento.get(v1.USER_DATA_KEY)).toEqual(userData.v2_1_0)
    })

    test("the copy for 3.x passes 3.5.5's schema", async function () {
      await memento.update(v1.USER_DATA_KEY, userData.v3_5_5_withoutMaterialUrl)

      await migrate()

      expect(v2.userDataSchema.safeParse(memento.get(v1.USER_DATA_KEY)).success).toBe(true)
    })

    test("reads a null description 0.1.0 stored as an empty one", async function () {
      await memento.update(v0.USER_DATA_KEY, userData.v0_1_0_nullDescription)

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()?.courses).toEqual([
        expect.objectContaining({ id: 0, description: "", title: "test-python-course" }),
      ])
    })

    test("reads a course stored without a material URL", async function () {
      await memento.update(v1.USER_DATA_KEY, userData.v3_5_5_withoutMaterialUrl)

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()?.courses).toEqual([
        expect.objectContaining({ id: 7, materialUrl: null }),
      ])
    })

    test("leaves the courses migrated when lifting pre-2.1 settings fails", async function () {
      await memento.update(v1.USER_DATA_KEY, userData.v2_0_0)
      await memento.update(v1.EXTENSION_SETTINGS_KEY, extensionSettings.v2_0_0)
      await memento.update(v1.SESSION_STATE_KEY, { extensionVersion: "2.0.0" })
      vi.mocked(settings.update).mockRejectedValue(new Error("settings.json is read-only"))

      const outcome = await migrate()

      expect(outcome).toEqual(
        expect.objectContaining({ kind: "failed", hasMigratedUserData: true }),
      )
      expect(storage.getUserData()).toEqual(userData.v3_0_0)
    })

    test("keeps the raw course it cannot read, which the copy for 3.x leaves out", async function () {
      const valid = userData.v2_1_0.courses[0]
      if (!valid) {
        throw new Error("fixture has no course")
      }
      const broken = { ...valid, id: 5, name: 7 }
      await memento.update(v1.USER_DATA_KEY, { courses: [valid, broken] })

      await migrate()

      expect(memento.get(v1.USER_DATA_KEY)).toEqual({ courses: [valid] })
      expect(keptUnreadable()).toEqual([broken])
    })

    test("migrates the courses without the TestMyCode tools", async function () {
      await memento.update(v0.USER_DATA_KEY, userData.v0_9_0)
      await memento.update(v0.EXTENSION_SETTINGS_KEY, extensionSettings.v0_9_0("/data"))

      expect((await migrate(false)).kind).toBe("done")

      expect(storage.getUserData()?.courses).toHaveLength(1)
      // The exercise migration still needs the old settings for where exercises were.
      expect(memento.get(v0.EXTENSION_SETTINGS_KEY)).toBeDefined()
    })
  })

  suite("session state", function () {
    // The first start after an update tells an update from an install by this version.
    test("keeps the version 3.5.5 recorded, so its users count as updating", async function () {
      await memento.update(v1.SESSION_STATE_KEY, { extensionVersion: "3.5.5" })
      await memento.update(v1.USER_DATA_KEY, userData.v2_1_0)

      await migrate()

      expect(storage.getSessionState()).toEqual({ extensionVersion: "3.5.5" })
    })

    test("carries a pre-2.0 version into the session state", async function () {
      await memento.update(v0.EXTENSION_VERSION_KEY, "1.3.4")

      await migrate()

      expect(storage.getSessionState()).toEqual({ extensionVersion: "1.3.4" })
    })
  })

  suite("a downgrade to 3.5.5 and back", function () {
    const kept = tmcCourse(1, "kept")
    const changedBase = tmcCourse(2, "changed")
    const changed: TmcLocalCourseData = {
      ...changedBase,
      offeredNewExercises: [20],
      exercises: changedBase.exercises.map((exercise) => ({ ...exercise, attempted: true })),
    }
    const removed = tmcCourse(3, "removed")

    beforeEach(async function () {
      await storage.updateUserData({
        courses: [kept, changed, removed],
        mooc_courses: [moocCourse],
      })
    })

    /** Changes `user-data-v1` the way 3.5.5 would while 4.x is not running. */
    async function asIf355Changed(change: (courses: V355UserData) => V355UserData): Promise<void> {
      const stored = structuredClone(memento.get<V355UserData>(v1.USER_DATA_KEY))
      if (!stored) {
        throw new Error("4.x left no copy for 3.5.5")
      }
      await memento.update(v1.USER_DATA_KEY, change(stored))
    }

    test("keeps every course when 3.5.5 changed nothing", async function () {
      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()).toEqual({
        courses: [kept, changed, removed],
        mooc_courses: [moocCourse],
      })
      expect(migrationLog()).toEqual([])
    })

    test("takes the courses 3.5.5 added, removed and changed, and keeps the mooc ones", async function () {
      await asIf355Changed(({ courses }) => ({
        courses: [
          ...courses
            .filter((course) => course.id !== removed.id)
            .map((course) =>
              course.id === changed.id
                ? {
                    ...course,
                    awardedPoints: 1,
                    exercises: course.exercises.map((x) => ({
                      ...x,
                      passed: true,
                      awardedPoints: 1,
                    })),
                  }
                : course,
            ),
          { ...tmcCourse(4, "added"), materialUrl: "https://example.com" },
        ],
      }))

      expect((await migrate()).kind).toBe("done")

      const migrated = storage.getUserData()
      expect(migrated?.mooc_courses).toEqual([moocCourse])
      expect(migrated?.courses.map((course) => course.id)).toEqual([1, 2, 4])
      expect(migrated?.courses[0]).toEqual(kept)
      // What v1 cannot express survives the change 3.5.5 made.
      expect(migrated?.courses[1]).toEqual({
        ...changed,
        awardedPoints: 1,
        exercises: changed.exercises.map((exercise) => ({
          ...exercise,
          passed: true,
          awardedPoints: 1,
        })),
      })
      expect(memento.get(v1.USER_DATA_KEY)).toEqual({
        courses: migrated?.courses.map(() =>
          expect.not.objectContaining({ offeredNewExercises: expect.anything() }),
        ),
      })
    })

    test("removes every tmc course when 3.5.5 removed them all", async function () {
      await asIf355Changed(() => ({ courses: [] }))

      await migrate()

      expect(storage.getUserData()).toEqual({ courses: [], mooc_courses: [moocCourse] })
      expect(memento.get(v1.USER_DATA_KEY)).toBeUndefined()
    })

    test("is idempotent once the changes are merged", async function () {
      await asIf355Changed(({ courses }) => ({ courses: courses.slice(1) }))
      await migrate()
      const merged = storage.getUserData()
      const runs = migrationLog().length

      await migrate()

      expect(storage.getUserData()).toEqual(merged)
      expect(migrationLog()).toHaveLength(runs)
    })

    test("keeps a course whose entry 3.5.5's copy holds but cannot be read", async function () {
      await asIf355Changed(({ courses }) => ({
        courses: courses.map((course) =>
          course.id === kept.id ? { ...course, exercises: "garbage" as never } : course,
        ),
      }))
      const unreadableEntry = memento.get<V355UserData>(v1.USER_DATA_KEY)?.courses[0]

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()?.courses.map((course) => course.id)).toEqual([1, 2, 3])
      expect(keptUnreadable()).toEqual([unreadableEntry])
    })

    test("keeps the raw entry of a course 3.5.5 added that cannot be read", async function () {
      const added = { ...tmcCourse(4, "added"), exercises: [{ id: "x", passed: true }] }
      await asIf355Changed(({ courses }) => ({ courses: [...courses, added as never] }))

      await migrate()

      expect(keptUnreadable()).toEqual([added])
      // The course itself is taken, without the exercise it cannot read.
      expect(storage.getUserData()?.courses.find((course) => course.id === 4)?.exercises).toEqual(
        [],
      )
      expect(memento.get<V355UserData>(v1.USER_DATA_KEY)?.courses).toHaveLength(4)
    })

    test("keeps each raw entry once however often it is merged", async function () {
      await asIf355Changed(({ courses }) => ({ courses: [...courses, { name: 1 } as never] }))
      await migrate()
      await asIf355Changed(({ courses }) => ({ courses: [...courses, { name: 1 } as never] }))

      await migrate()

      expect(keptUnreadable()).toEqual([{ name: 1 }])
    })

    // An earlier 4.0 build retired user-data-v1 without mirroring to it.
    suite("without a record of what this version mirrored", function () {
      beforeEach(async function () {
        await memento.update(v3.LEGACY_MIRROR_RECORD_KEY, undefined)
      })

      test("takes the courses 3.5.5 added and changed, but removes none", async function () {
        await memento.update(v1.USER_DATA_KEY, {
          courses: [{ ...kept, awardedPoints: 1 }, tmcCourse(4, "added")],
        })

        expect((await migrate()).kind).toBe("done")

        expect(storage.getUserData()?.courses).toEqual([
          { ...kept, awardedPoints: 1 },
          changed,
          removed,
          tmcCourse(4, "added"),
        ])
        expect(memento.get(v3.LEGACY_MIRROR_RECORD_KEY)).toEqual({ courseIds: [1, 2, 3, 4] })
      })

      test("rewrites a missing copy for 3.x from v3", async function () {
        await memento.update(v1.USER_DATA_KEY, undefined)

        expect((await migrate()).kind).toBe("done")

        expect(storage.getUserData()?.courses).toEqual([kept, changed, removed])
        expect(memento.get<V355UserData>(v1.USER_DATA_KEY)?.courses).toHaveLength(3)
        expect(memento.get(v3.LEGACY_MIRROR_RECORD_KEY)).toEqual({ courseIds: [1, 2, 3] })
      })
    })

    test("removes the tmc courses when 3.5.5 wiped its storage", async function () {
      await memento.update(v1.USER_DATA_KEY, undefined)

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()).toEqual({ courses: [], mooc_courses: [moocCourse] })
      expect(memento.get(v3.LEGACY_MIRROR_RECORD_KEY)).toEqual({ courseIds: [] })
    })

    test("removes only the courses it mirrored", async function () {
      await storage.updateUserData({ courses: [kept], mooc_courses: [] })
      const v3Only = tmcCourse(6, "never-mirrored")
      await memento.update(v3.USER_DATA_KEY, { courses: [kept, v3Only], mooc_courses: [] })
      await asIf355Changed(() => ({ courses: [] }))

      await migrate()

      expect(storage.getUserData()?.courses).toEqual([v3Only])
    })

    test("removes nothing when an entry without a readable id may be any course", async function () {
      await asIf355Changed(({ courses }) => ({
        courses: [...courses.slice(1), { batman: "Bruce Wayne" } as never],
      }))

      await migrate()

      expect(storage.getUserData()?.courses.map((course) => course.id)).toEqual([1, 2, 3])
    })

    test("keeps v3 and repairs 3.5.5's copy when it is unreadable", async function () {
      const mirror = memento.get(v1.USER_DATA_KEY)
      await memento.update(v1.USER_DATA_KEY, "garbage")

      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()?.courses).toEqual([kept, changed, removed])
      expect(memento.get(v1.USER_DATA_KEY)).toEqual(mirror)
      expect(keptUnreadable()).toEqual(["garbage"])
      expect(migrationLog()).toEqual([
        expect.objectContaining({
          keysWritten: expect.arrayContaining([v1.USER_DATA_KEY]),
          droppedEntries: 1,
        }),
      ])
    })

    // The 4.99 rollback build copies v3's tmc courses into user-data-v1 whole, fields v1 lacks
    // included, and then works on that copy alone.
    test("takes the tmc courses a rollback build added and removed", async function () {
      await memento.update(v1.USER_DATA_KEY, {
        courses: [kept, changed, tmcCourse(5, "added-in-rollback")],
      })
      await memento.update("user-data-v3-imported", "sha256-of-v3")

      expect((await migrate()).kind).toBe("done")

      const migrated = storage.getUserData()
      expect(migrated?.courses).toEqual([kept, changed, tmcCourse(5, "added-in-rollback")])
      expect(migrated?.mooc_courses).toEqual([moocCourse])
    })

    test("never replays a v0 key over v3", async function () {
      await memento.update(v0.USER_DATA_KEY, userData.v0_9_0)

      await migrate()

      expect(storage.getUserData()?.courses).toEqual([kept, changed, removed])
    })
  })

  suite("saving", function () {
    test("leaves the copy for 3.x alone when only mooc courses changed", async function () {
      await storage.updateUserData({ courses: [tmcCourse(1, "tmc")], mooc_courses: [] })
      const update = vi.spyOn(memento, "update")

      await storage.updateUserData({ courses: [tmcCourse(1, "tmc")], mooc_courses: [moocCourse] })

      expect(update.mock.calls.map(([key]) => key)).toEqual([v3.USER_DATA_KEY])
    })

    test("does no work on the copy for 3.x for a change said to touch only mooc courses", async function () {
      await storage.updateUserData({ courses: [tmcCourse(1, "tmc")], mooc_courses: [] })
      const get = vi.spyOn(memento, "get")

      await storage.updateUserData(
        { courses: [tmcCourse(1, "tmc")], mooc_courses: [moocCourse] },
        { isMoocOnlyChange: true },
      )

      expect(get).not.toHaveBeenCalled()
      expect(storage.getUserData()?.mooc_courses).toEqual([moocCourse])
    })

    test("syncs the copy for 3.x after a write that failed, whatever changed", async function () {
      const update = memento.update.bind(memento)
      vi.spyOn(memento, "update").mockImplementationOnce(() => {
        throw new Error("disk full")
      })
      await expect(
        storage.updateUserData({ courses: [tmcCourse(1, "tmc")], mooc_courses: [] }),
      ).rejects.toThrow("disk full")
      vi.mocked(memento.update).mockImplementation(update)

      await storage.updateUserData(
        { courses: [tmcCourse(1, "tmc")], mooc_courses: [moocCourse] },
        { isMoocOnlyChange: true },
      )

      expect(memento.get(v1.USER_DATA_KEY)).toEqual({ courses: [tmcCourse(1, "tmc")] })
    })

    test("deletes no copy for 3.x a mooc-only student never had", async function () {
      await storage.updateUserData({ courses: [], mooc_courses: [] })
      const update = vi.spyOn(memento, "update")

      await storage.updateUserData({ courses: [], mooc_courses: [moocCourse] })

      expect(update).not.toHaveBeenCalledWith(v1.USER_DATA_KEY, undefined)
    })
  })

  suite("partly invalid data", function () {
    test("drops only the invalid courses and exercises, saying which and why", async function () {
      const warn = vi.spyOn(Logger, "warn")
      const valid = userData.v2_1_0.courses[0]
      if (!valid) {
        throw new Error("fixture has no course")
      }
      await memento.update(v1.USER_DATA_KEY, {
        courses: [
          { ...valid, exercises: [...valid.exercises, { id: "x", passed: true }] },
          { ...valid, id: "not-a-number", name: "broken-course" },
          { ...valid, id: 5, name: "second" },
        ],
      })

      expect((await migrate()).kind).toBe("done")

      const courses = storage.getUserData()?.courses
      expect(courses?.map((course) => course.id)).toEqual([0, 5])
      expect(courses?.[0]?.exercises).toHaveLength(2)
      const warnings = warn.mock.calls.map((call) => String(call[0]))
      expect(warnings).toContainEqual(
        expect.stringMatching(/course 0, exercise at index 2[\s\S]*at id/),
      )
      expect(warnings).toContainEqual(expect.stringMatching(/course at index 1[\s\S]*at id/))
      expect(migrationLog()).toEqual([expect.objectContaining({ droppedEntries: 2 })])
    })
  })

  suite("total failure", function () {
    async function storeUnreadableCourses(): Promise<unknown> {
      const unreadable = { courses: [{ id: "a" }, { id: 1, name: 2 }] }
      await memento.update(v1.USER_DATA_KEY, unreadable)
      return unreadable
    }

    test("fails loudly without writing v3 over the old data", async function () {
      const unreadable = await storeUnreadableCourses()

      const outcome = await migrate()

      expect(outcome).toEqual({
        kind: "failed",
        error: expect.any(StoredDataMigrationError),
        hasMigratedUserData: false,
      })
      expect(memento.get(v3.USER_DATA_KEY)).toBeUndefined()
      expect(memento.get(v1.USER_DATA_KEY)).toEqual(unreadable)
    })

    test("fails on stored data that is not a course list", async function () {
      await memento.update(v0.USER_DATA_KEY, { courses: "garbage" })

      const outcome = await migrate()

      expect(outcome.kind).toBe("failed")
      expect(memento.get(v0.USER_DATA_KEY)).toEqual({ courses: "garbage" })
    })

    test("records the run and carries the log in the error details", async function () {
      await storeUnreadableCourses()

      const outcome = await migrate()

      expect(migrationLog()).toEqual([
        expect.objectContaining({
          outcome: "failed",
          toVersion: EXTENSION_VERSION,
          keysRead: expect.arrayContaining([v1.USER_DATA_KEY]),
          keysWritten: [],
        }),
      ])
      expect(outcome.kind === "failed" && outcome.error.details).toMatch(/failed/)
    })

    test("succeeds on a retry once the data is readable", async function () {
      await storeUnreadableCourses()
      await migrate()

      await memento.update(v1.USER_DATA_KEY, userData.v2_1_0)
      expect((await migrate()).kind).toBe("done")

      expect(storage.getUserData()).toEqual(userData.v3_0_0)
    })

    test("leaves the courses migrated when only the exercise step fails", async function () {
      await memento.update(v1.USER_DATA_KEY, userData.v2_1_0)
      await memento.update(v0.EXERCISE_DATA_KEY, [
        { id: 1, checksum: "abc", name: "hello_world", course: "c", organization: "o" },
      ])
      vi.mocked(dialog.progressNotification).mockRejectedValueOnce(new Error("langs crashed"))

      const outcome = await migrate()

      expect(outcome).toEqual(
        expect.objectContaining({ kind: "failed", hasMigratedUserData: true }),
      )
      expect(storage.getUserData()).toEqual(userData.v3_0_0)
    })
  })

  suite("backup", function () {
    test("holds the raw legacy values as the first migration found them", async function () {
      await memento.update(v0.USER_DATA_KEY, userData.v0_1_0_nullDescription)
      await memento.update(v0.EXTENSION_VERSION_KEY, "1.3.4")

      await migrate()

      expect(memento.get(v3.LEGACY_DATA_BACKUP_KEY)).toEqual({
        createdAt: expect.any(String),
        fromVersion: "1.3.4",
        toVersion: EXTENSION_VERSION,
        values: {
          [v0.USER_DATA_KEY]: userData.v0_1_0_nullDescription,
          [v0.EXTENSION_VERSION_KEY]: "1.3.4",
        },
      })
    })

    test("is written once and never overwritten", async function () {
      await memento.update(v1.USER_DATA_KEY, userData.v2_0_0)
      await migrate()
      const backup = memento.get(v3.LEGACY_DATA_BACKUP_KEY)

      await memento.update(v1.USER_DATA_KEY, { courses: [tmcCourse(9, "from-3.5.5")] })
      await migrate()

      expect(storage.getUserData()?.courses.map((course) => course.id)).toEqual([9])
      expect(memento.get(v3.LEGACY_DATA_BACKUP_KEY)).toEqual(backup)
    })

    test("is not written when there is nothing to migrate", async function () {
      await migrate()
      await storage.updateUserData({ courses: [tmcCourse(1, "fresh")], mooc_courses: [] })
      await migrate()

      expect(memento.get(v3.LEGACY_DATA_BACKUP_KEY)).toBeUndefined()
    })

    test("is not written by a failed run, which writes nothing", async function () {
      await memento.update(v1.USER_DATA_KEY, { courses: "garbage" })

      await migrate()

      expect(memento.get(v3.LEGACY_DATA_BACKUP_KEY)).toBeUndefined()
      expect(memento.get(v1.USER_DATA_KEY)).toEqual({ courses: "garbage" })
    })
  })

  suite("migration log", function () {
    test("records a migrating run with the keys it touched", async function () {
      await memento.update(v0.USER_DATA_KEY, userData.v0_9_0)
      await memento.update(v1.SESSION_STATE_KEY, { extensionVersion: "3.5.5" })

      await migrate()

      expect(migrationLog()).toEqual([
        {
          at: expect.any(String),
          fromVersion: "3.5.5",
          toVersion: EXTENSION_VERSION,
          outcome: "migrated",
          keysRead: expect.arrayContaining([v0.USER_DATA_KEY]),
          keysWritten: expect.arrayContaining([v1.USER_DATA_KEY, v3.USER_DATA_KEY]),
          keysRetired: [v0.USER_DATA_KEY],
          droppedEntries: 0,
        },
      ])
      expect(storage.getMigrationLog()).toMatch(/3\.5\.5 -> .*: migrated/)
    })

    test("keeps only the latest ten runs", async function () {
      for (let run = 0; run < 12; run++) {
        await memento.update(v1.USER_DATA_KEY, { courses: "garbage" })
        await migrate()
      }

      expect(migrationLog()).toHaveLength(10)
    })
  })
})
