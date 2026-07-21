import * as path from "path"

import * as fs from "fs-extra"
import { Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import type Langs from "../../api/langs"
import type * as data from "../../storage/data"
import migrateBackendNamespacing, {
  BACKEND_NAMESPACING_MIGRATION_DONE_KEY,
} from "../../storage/migration/backendNamespacing"
import { Logger, LogLevel } from "../../utilities"
import { createMockMemento } from "../mocks/vscode"
import { makeTmpDirs } from "../utils"

// Minimal Langs stub backed by an in-memory settings map so we can assert the
// exact end state of the TMC-langs settings store after migration.
function createSettingsLangsMock(initial: Record<string, unknown>): {
  langs: Langs
  settings: Map<string, unknown>
  getSetting: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
  unsetSetting: ReturnType<typeof vi.fn>
} {
  const settings = new Map<string, unknown>(Object.entries(initial))
  const getSetting = vi.fn(async (key: string) =>
    Ok(settings.has(key) ? settings.get(key) : undefined),
  )
  const setSetting = vi.fn(async (key: string, value: unknown) => {
    settings.set(key, value)
    return Ok.EMPTY
  })
  const unsetSetting = vi.fn(async (key: string) => {
    settings.delete(key)
    return Ok.EMPTY
  })
  const langs = { getSetting, setSetting, unsetSetting } as unknown as Langs
  return { langs, settings, getSetting, setSetting, unsetSetting }
}

function userDataWith(tmcNames: string[], moocNames: string[] = []): data.UserData {
  return {
    courses: tmcNames.map((name) => ({ name }) as data.TmcLocalCourseData),
    mooc_courses: moocNames.map((name) => ({ name }) as data.MoocLocalCourseData),
  }
}

suite("Backend-namespacing migration", function () {
  let memento: vscode.Memento

  beforeEach(function () {
    memento = createMockMemento()
    Logger.configure(LogLevel.Verbose)
  })

  test("does nothing (but marks done) when there is no user data", async function () {
    const { langs, getSetting } = createSettingsLangsMock({})
    const folder = makeTmpDirs({})
    await migrateBackendNamespacing(memento, langs, folder, undefined)
    expect(getSetting).not.toHaveBeenCalled()
    expect(memento.get(BACKEND_NAMESPACING_MIGRATION_DONE_KEY)).toBe(true)
  })

  test("rewrites a legacy closed-exercises setting into the tmc namespace, preserving its value", async function () {
    const closed = ["ex_two", "ex_five"]
    const { langs, settings } = createSettingsLangsMock({
      "closed-exercises-for:python-course": closed,
    })
    const folder = makeTmpDirs({})

    await migrateBackendNamespacing(memento, langs, folder, userDataWith(["python-course"]))

    // The value is preserved verbatim under the new namespaced key, and the
    // legacy key is cleared -- not discarded.
    expect(settings.get("closed-exercises-for:tmc:python-course")).toEqual(closed)
    expect(settings.has("closed-exercises-for:python-course")).toBe(false)
  })

  test("leaves courses without a legacy setting untouched (no empty write)", async function () {
    const { langs, settings, setSetting } = createSettingsLangsMock({})
    const folder = makeTmpDirs({})
    await migrateBackendNamespacing(memento, langs, folder, userDataWith(["fresh-course"]))
    expect(setSetting).not.toHaveBeenCalled()
    expect(settings.size).toBe(0)
  })

  test("renames the legacy .code-workspace file to the tmc-tagged name", async function () {
    const { langs } = createSettingsLangsMock({})
    const folder = makeTmpDirs({ "python-course.code-workspace": '{"folders":[]}' })

    await migrateBackendNamespacing(memento, langs, folder, userDataWith(["python-course"]))

    expect(fs.existsSync(path.join(folder, "python-course.code-workspace"))).toBe(false)
    const renamed = path.join(folder, "python-course-tmc.code-workspace")
    expect(fs.existsSync(renamed)).toBe(true)
    // Contents carried over so the user's open editors aren't lost.
    expect(fs.readFileSync(renamed, "utf-8")).toBe('{"folders":[]}')
  })

  test("does not clobber an already-migrated workspace file", async function () {
    const { langs } = createSettingsLangsMock({})
    const folder = makeTmpDirs({
      "python-course.code-workspace": '{"legacy":true}',
      "python-course-tmc.code-workspace": '{"new":true}',
    })
    await migrateBackendNamespacing(memento, langs, folder, userDataWith(["python-course"]))
    expect(fs.readFileSync(path.join(folder, "python-course-tmc.code-workspace"), "utf-8")).toBe(
      '{"new":true}',
    )
  })

  test("is flag-gated: a second run makes no CLI calls", async function () {
    const { langs, getSetting } = createSettingsLangsMock({
      "closed-exercises-for:python-course": ["ex_one"],
    })
    const folder = makeTmpDirs({})
    await migrateBackendNamespacing(memento, langs, folder, userDataWith(["python-course"]))
    const callsAfterFirst = getSetting.mock.calls.length
    await migrateBackendNamespacing(memento, langs, folder, userDataWith(["python-course"]))
    expect(getSetting.mock.calls.length).toBe(callsAfterFirst)
  })

  test("migrates a mooc course's legacy (tmc-only) state into the tmc namespace", async function () {
    // A same-named course now on mooc: its pre-migration state was still tmc.
    const { langs, settings } = createSettingsLangsMock({
      "closed-exercises-for:shared-name": ["ex_x"],
    })
    const folder = makeTmpDirs({ "shared-name.code-workspace": "{}" })

    await migrateBackendNamespacing(memento, langs, folder, userDataWith([], ["shared-name"]))

    expect(settings.get("closed-exercises-for:tmc:shared-name")).toEqual(["ex_x"])
    expect(fs.existsSync(path.join(folder, "shared-name-tmc.code-workspace"))).toBe(true)
  })
})
